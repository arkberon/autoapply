import { db, logEvent, now } from './db.ts'
import { isNoBotBoard } from './ats.ts'
import type { Job, Live, VerifyProgress } from '../shared/types.ts'

// Checks whether each posting is still open. Hosted boards publish a small
// public JSON feed, which is quicker and more reliable than loading the page.

interface Result {
  live: Live
  note: string
}

const UA = 'Mozilla/5.0 (compatible; autoapply-personal/0.1; job posting status check)'

const CLOSED_PHRASES = [
  'no longer accepting applications',
  'no longer available',
  'no longer open',
  'position has been filled',
  'job has been filled',
  'job not found',
  'job you are looking for',
  'this job has expired',
  'posting has closed',
  'posting is closed',
  'this position is closed',
]

async function get(url: string, accept = 'application/json'): Promise<Response> {
  return fetch(url, {
    headers: { 'user-agent': UA, accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  })
}

async function checkGreenhouse(job: Job): Promise<Result> {
  // The US API host also serves boards hosted on job-boards.eu.greenhouse.io.
  const res = await get(`https://boards-api.greenhouse.io/v1/boards/${job.org}/jobs/${job.posting_id}`)
  if (res.status === 404) return { live: 'closed', note: 'Removed from the Greenhouse board' }
  if (!res.ok) return checkPage(job)
  return { live: 'open', note: 'Listed on the Greenhouse board' }
}

// One request returns every open posting for a company, so share it across that company's jobs.
const ashbyBoards = new Map<string, Promise<Set<string> | null>>()

function ashbyBoard(org: string): Promise<Set<string> | null> {
  let board = ashbyBoards.get(org)
  if (!board) {
    board = get(`https://api.ashbyhq.com/posting-api/job-board/${org}`)
      .then(async (res) => {
        if (!res.ok) return null
        const body = (await res.json()) as { jobs?: { id: string }[] }
        return new Set((body.jobs ?? []).map((j) => j.id))
      })
      .catch(() => null)
    ashbyBoards.set(org, board)
  }
  return board
}

async function checkAshby(job: Job): Promise<Result> {
  const board = await ashbyBoard(job.org!)
  if (board?.has(job.posting_id!)) return { live: 'open', note: 'Listed on the Ashby board' }

  // Unlisted postings stay reachable by direct link, and some companies turn the
  // board feed off, so absence from the board is not proof of closure. The posting
  // page embeds "posting":null once it is gone.
  const page = await get(`https://jobs.ashbyhq.com/${job.org}/${job.posting_id}`, 'text/html')
  const html = page.ok ? await page.text() : ''
  if (html.includes('"posting":null')) return { live: 'closed', note: 'Ashby no longer has this posting' }
  if (html.includes('"posting":{')) return { live: 'open', note: 'Open by direct link (not on the public board)' }
  return { live: 'unknown', note: 'Ashby did not say either way; check by hand' }
}

async function checkLever(job: Job): Promise<Result> {
  const res = await get(`https://api.lever.co/v0/postings/${job.org}/${job.posting_id}`)
  if (res.status === 404) return { live: 'closed', note: 'Removed from the Lever board' }
  if (!res.ok) return checkPage(job)
  return { live: 'open', note: 'Listed on the Lever board' }
}

async function checkWorkday(job: Job): Promise<Result> {
  const url = new URL(job.url)
  const parts = url.pathname.split('/').filter(Boolean)
  if (/^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? '')) parts.shift()
  const res = await get(`${url.origin}/wday/cxs/${job.org}/${parts.join('/')}`)
  const body = (await res.json().catch(() => null)) as
    | { jobPostingInfo?: { canApply?: boolean }; errorCode?: string }
    | null

  if (res.ok && body?.jobPostingInfo) {
    return body.jobPostingInfo.canApply === false
      ? { live: 'closed', note: 'Workday is not accepting applications' }
      : { live: 'open', note: 'Listed on the Workday site' }
  }
  // S21 is Workday's "no such posting". Many employers answer 403 to this feed
  // for every posting, so anything else says nothing about the job itself.
  if (body?.errorCode === 'S21') return { live: 'closed', note: 'Removed from the Workday site' }
  return { live: 'unknown', note: 'This employer hides posting status; you will see it when you sign in' }
}

async function checkPage(job: Job): Promise<Result> {
  const res = await get(job.url, 'text/html,*/*')
  if (res.status === 404 || res.status === 410) return { live: 'closed', note: `Page is gone (${res.status})` }
  if (!res.ok) return { live: 'unknown', note: `Page answered ${res.status}; check by hand` }
  const text = (await res.text()).toLowerCase()
  const phrase = CLOSED_PHRASES.find((p) => text.includes(p))
  if (phrase) return { live: 'closed', note: `Page says "${phrase}"` }
  return { live: 'open', note: 'Page loads; no closed notice found' }
}

export async function checkJob(job: Job): Promise<Result> {
  try {
    if (job.mode === 'email') return { live: 'unknown', note: 'Email application; nothing to check' }
    if (isNoBotBoard(job.ats)) return { live: 'unknown', note: `${job.ats} does not allow automated checks; you will see it when you open it` }
    if (job.ats === 'Greenhouse') return await checkGreenhouse(job)
    if (job.ats === 'Ashby') return await checkAshby(job)
    if (job.ats === 'Lever') return await checkLever(job)
    if (job.ats === 'Workday') return await checkWorkday(job)
    return await checkPage(job)
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached'
    return { live: 'unknown', note: `Check ${reason}` }
  }
}

const progress: VerifyProgress = { running: false, done: 0, total: 0, startedAt: null, finishedAt: null }

export const verifyProgress = (): VerifyProgress => ({ ...progress })

/** Re-checks every job that has not been applied to. Runs in the background; poll verifyProgress(). */
export function startVerify(): VerifyProgress {
  if (progress.running) return verifyProgress()

  const jobs = db.prepare<[], Job>("SELECT * FROM jobs WHERE status != 'applied' AND removed = 0").all()
  const save = db.prepare('UPDATE jobs SET live = ?, live_note = ?, live_checked_at = ? WHERE id = ?')
  Object.assign(progress, { running: true, done: 0, total: jobs.length, startedAt: now(), finishedAt: null })
  ashbyBoards.clear()

  const queue = [...jobs]
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const result = await checkJob(job)
      save.run(result.live, result.note, now(), job.id)
      progress.done++
    }
  }

  Promise.all(Array.from({ length: 6 }, worker)).finally(() => {
    Object.assign(progress, { running: false, finishedAt: now() })
    logEvent(null, 'verify', `${jobs.length} jobs checked`)
  })
  return verifyProgress()
}

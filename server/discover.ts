import { db, getSetting, logEvent, now, setSetting } from './db.ts'
import type { DiscoverProgress, DiscoverSettings, Priority } from '../shared/types.ts'

// Finds new openings on the job boards of companies already on the list (plus
// any boards added in Settings) and adds the matching ones straight to the
// database. No spreadsheet export is involved.

type Ats = 'Greenhouse' | 'Ashby' | 'Lever'

interface Board {
  ats: Ats
  org: string
}

interface Posting {
  ats: Ats
  org: string
  postingId: string
  company: string | null
  title: string
  location: string
  url: string
  publishedAt: string | null
}

const UA = 'Mozilla/5.0 (compatible; autoapply-personal/0.1; job discovery)'

export const DISCOVER_DEFAULTS: DiscoverSettings = {
  // Role words only. Seniority words such as "new grad" raise priority instead of deciding a match.
  include:
    'software engineer, software developer, web developer, full stack, full-stack, frontend, front-end, front end, backend, back-end, back end, web engineer, mobile engineer, ios engineer, android engineer, product engineer, support engineer, solutions engineer, implementation, technical support, it support, help desk, qa engineer, qa analyst, sdet, software test, automation engineer',
  exclude:
    'senior, sr, sr., staff, principal, lead, manager, director, head of, vp, architect, intern, internship, ii, iii, iv, phd, clearance, hardware, electrical, mechanical, rf, manufacturing, sales',
  locations:
    'new york, nyc, brooklyn, manhattan, jersey city, hoboken, los angeles, santa monica, culver city, pasadena, irvine, orange county, costa mesa, newport beach, miami, fort lauderdale, remote',
  maxAgeDays: 45,
}

// "Remote" alone is accepted, but not when the posting names a country outside the US.
const NON_US = /\b(uk|united kingdom|london|canada|toronto|vancouver|europe|emea|germany|berlin|france|paris|spain|india|bangalore|australia|sydney|singapore|japan|brazil|mexico|latam|south america|argentina|colombia|apac|ireland|dublin|netherlands|amsterdam|poland|israel|philippines)\b/i

const ENTRY_LEVEL = /\b(new grad|graduate|junior|jr\.?|entry[- ]level|early career|associate|engineer i|developer i|level 1|i)\b(?!\w)/i

export function discoverSettings(): DiscoverSettings {
  return {
    include: getSetting('discover_include', DISCOVER_DEFAULTS.include),
    exclude: getSetting('discover_exclude', DISCOVER_DEFAULTS.exclude),
    locations: getSetting('discover_locations', DISCOVER_DEFAULTS.locations),
    maxAgeDays: Number(getSetting('discover_max_age_days', String(DISCOVER_DEFAULTS.maxAgeDays))) || DISCOVER_DEFAULTS.maxAgeDays,
  }
}

/** Turns "a, b, c" into one case-insensitive whole-word pattern. */
function wordList(list: string): RegExp | null {
  const terms = list
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return terms.length ? new RegExp(`(^|[^a-z0-9])(${terms.join('|')})($|[^a-z0-9])`, 'i') : null
}

/** Accepts a company's board link, e.g. https://jobs.ashbyhq.com/acme or https://boards.greenhouse.io/acme. */
export function parseBoardUrl(raw: string): Board | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  const org = url.pathname.split('/').filter(Boolean)[0]
  if (!org) return null
  if (/(^|\.)greenhouse\.io$/.test(host)) return { ats: 'Greenhouse', org }
  if (host === 'jobs.ashbyhq.com') return { ats: 'Ashby', org }
  if (host === 'jobs.lever.co') return { ats: 'Lever', org }
  return null
}

function extraBoards(): Board[] {
  try {
    return JSON.parse(getSetting('discover_boards', '[]')) as Board[]
  } catch {
    return []
  }
}

export function addBoard(board: Board) {
  const boards = extraBoards().filter((b) => !(b.ats === board.ats && b.org === board.org))
  setSetting('discover_boards', JSON.stringify([...boards, board]))
}

export function watchedBoards(): Board[] {
  const known = db
    .prepare<[], Board>(
      "SELECT DISTINCT ats, org FROM jobs WHERE org IS NOT NULL AND ats IN ('Greenhouse', 'Ashby', 'Lever')",
    )
    .all()
  const seen = new Set(known.map((b) => `${b.ats}/${b.org}`))
  return [...known, ...extraBoards().filter((b) => !seen.has(`${b.ats}/${b.org}`))]
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

async function fetchBoard(board: Board): Promise<Posting[] | null> {
  const { ats, org } = board
  if (ats === 'Greenhouse') {
    const body = await getJson<{
      jobs: { id: number; title: string; absolute_url: string; location?: { name?: string }; first_published?: string; company_name?: string }[]
    }>(`https://boards-api.greenhouse.io/v1/boards/${org}/jobs`)
    return (
      body?.jobs.map((j) => ({
        ats,
        org,
        postingId: String(j.id),
        company: j.company_name ?? null,
        title: j.title,
        location: j.location?.name ?? '',
        url: j.absolute_url,
        publishedAt: j.first_published ?? null,
      })) ?? null
    )
  }
  if (ats === 'Ashby') {
    const body = await getJson<{
      jobs: { id: string; title: string; location?: string; isRemote?: boolean; jobUrl: string; publishedAt?: string; isListed?: boolean; secondaryLocations?: { location?: string }[] }[]
    }>(`https://api.ashbyhq.com/posting-api/job-board/${org}`)
    return (
      body?.jobs
        .filter((j) => j.isListed !== false)
        .map((j) => ({
          ats,
          org,
          postingId: j.id,
          company: null,
          title: j.title,
          location: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location), j.isRemote ? 'Remote' : '']
            .filter(Boolean)
            .join('; '),
          url: j.jobUrl,
          publishedAt: j.publishedAt ?? null,
        })) ?? null
    )
  }
  const body = await getJson<
    { id: string; text: string; hostedUrl: string; createdAt?: number; workplaceType?: string; country?: string; categories?: { location?: string; allLocations?: string[] } }[]
  >(`https://api.lever.co/v0/postings/${org}?mode=json`)
  return (
    body?.map((j) => ({
      ats,
      org,
      postingId: j.id,
      company: null,
      title: j.text,
      location: [
        ...(j.categories?.allLocations ?? [j.categories?.location ?? '']),
        j.workplaceType === 'remote' ? 'Remote' : '',
        j.country && j.country !== 'US' ? j.country : '',
      ]
        .filter(Boolean)
        .join('; '),
      url: j.hostedUrl,
      publishedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    })) ?? null
  )
}

/** Picks the lane label the rest of the list uses, from the posting's location text. */
function marketFor(location: string): string {
  const l = location.toLowerCase()
  if (/new york|nyc|brooklyn|manhattan|jersey city|hoboken/.test(l)) return 'NYC'
  if (/irvine|orange county|costa mesa|newport beach/.test(l)) return 'Irvine, CA'
  if (/los angeles|santa monica|culver city|pasadena/.test(l)) return 'LA'
  if (/miami|fort lauderdale/.test(l)) return 'Miami'
  return 'US remote'
}

function companyName(board: Board, posting: Posting): string {
  if (posting.company) return posting.company
  const known = db
    .prepare<[string, string], { company: string }>('SELECT company FROM jobs WHERE ats = ? AND org = ? LIMIT 1')
    .get(board.ats, board.org)
  return known?.company ?? board.org.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const progress: DiscoverProgress = {
  running: false,
  done: 0,
  total: 0,
  added: 0,
  failed: 0,
  finishedAt: getSetting('discover_last_run') || null,
  lastAdded: Number(getSetting('discover_last_added', '0')),
}

export const discoverProgress = (): DiscoverProgress => ({ ...progress })

export function startDiscover(): DiscoverProgress {
  if (progress.running) return discoverProgress()

  const settings = discoverSettings()
  const include = wordList(settings.include)
  const exclude = wordList(settings.exclude)
  const places = wordList(settings.locations)
  const oldest = Date.now() - settings.maxAgeDays * 86_400_000

  const boards = watchedBoards()
  Object.assign(progress, { running: true, done: 0, total: boards.length, added: 0, failed: 0 })

  const known = db.prepare<[string, string, string], { id: string }>(
    'SELECT id FROM jobs WHERE ats = ? AND org = ? AND posting_id = ?',
  )
  const knownUrl = db.prepare<[string], { id: string }>('SELECT id FROM jobs WHERE url = ?')
  const insert = db.prepare(`
    INSERT INTO jobs (id, company, role, market, location, url, ats, mode, org, posting_id, fit, difficulty,
      priority, priority_reason, status, live, live_note, live_checked_at, last_checked, discovered_at, raw)
    VALUES (@id, @company, @role, @market, @location, @url, @ats, 'auto', @org, @posting_id, @fit, '',
      @priority, @priority_reason, 'not_started', 'open', @live_note, @at, @today, @at, @raw)
    ON CONFLICT(id) DO NOTHING
  `)

  const fitsFilters = (p: Pick<Posting, 'title' | 'location'>): boolean => {
    if (!include?.test(p.title) || exclude?.test(p.title)) return false
    if (!places?.test(p.location)) return false
    if (/remote/i.test(p.location) && NON_US.test(p.location) && !/new york|los angeles|miami|irvine/i.test(p.location)) {
      return false
    }
    return true
  }

  const matches = (p: Posting): boolean =>
    fitsFilters(p) && !(p.publishedAt && new Date(p.publishedAt).getTime() < oldest)

  // Re-apply the current filters to earlier finds, so tightening a filter cleans the
  // list. Jobs the user has touched (priority set, applied, removed) are kept.
  const untouched = db
    .prepare<[], { id: string; role: string; location: string }>(
      "SELECT id, role, location FROM jobs WHERE discovered_at IS NOT NULL AND status = 'not_started' AND priority_locked = 0 AND removed = 0",
    )
    .all()
  const drop = db.prepare('DELETE FROM jobs WHERE id = ?')
  const dropped = untouched.filter((j) => !fitsFilters({ title: j.role, location: j.location }))
  db.transaction(() => dropped.forEach((j) => drop.run(j.id)))()

  const queue = [...boards]
  const worker = async () => {
    for (let board = queue.shift(); board; board = queue.shift()) {
      try {
        await searchBoard(board)
      } catch (err) {
        // One malformed board must not stop the search or take the server down.
        progress.failed++
        logEvent(null, 'discover_error', `${board.ats}/${board.org}: ${err instanceof Error ? err.message : String(err)}`)
      }
      progress.done++
    }
  }

  const searchBoard = async (board: Board) => {
    const postings = await fetchBoard(board)
    if (!postings) {
      progress.failed++
      return
    }
    for (const p of postings) {
      if (!matches(p) || known.get(p.ats, p.org, p.postingId) || knownUrl.get(p.url)) continue
      const entry = ENTRY_LEVEL.test(p.title)
      const at = now()
      // The same posting can appear on two boards of one company; the first one wins.
      const { changes } = insert.run({
        id: `disc_${p.ats.toLowerCase()}_${p.postingId}`,
        company: companyName(board, p),
        role: p.title,
        market: marketFor(p.location),
        location: p.location,
        url: p.url,
        ats: p.ats,
        org: p.org,
        posting_id: p.postingId,
        fit: entry ? 'Found automatically: entry-level title' : 'Found automatically: check the requirements',
        priority: (entry ? 2 : 3) satisfies Priority,
        priority_reason: entry
          ? "Found on the company's board · title says entry-level"
          : "Found on the company's board · title does not say entry-level; check the requirements",
        live_note: `Listed on the ${p.ats} board`,
        at,
        today: at.slice(0, 10),
        raw: JSON.stringify(p),
      })
      progress.added += changes
    }
  }

  Promise.all(Array.from({ length: 6 }, worker)).finally(() => {
    const at = now()
    Object.assign(progress, { running: false, finishedAt: at, lastAdded: progress.added })
    setSetting('discover_last_run', at)
    setSetting('discover_last_added', String(progress.added))
    logEvent(
      null,
      'discover',
      `${progress.total} boards, ${progress.added} new jobs, ${dropped.length} earlier finds no longer match, ${progress.failed} boards failed`,
    )
  })
  return discoverProgress()
}

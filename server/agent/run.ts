import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { DATA_DIR, db, logEvent, now } from '../db.ts'
import { resumeInfo, syncResume } from '../resume.ts'
import { extractFields, type FormField } from './extract.ts'
import { emptyRequired, fillField, readComboboxOptions } from './fill.ts'
import { decide, loadAnswers, type Decision, type JobContext } from './resolve.ts'
import type { AgentProgress, AgentRun, Job } from '../../shared/types.ts'

// The application agent. A dry run fills real forms and stops before submitting:
// the code has no submit step in that mode, and as a second safety every request
// that looks like a submission is blocked at the network level.

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    outcome TEXT NOT NULL DEFAULT 'running',
    reasons TEXT NOT NULL DEFAULT '[]',
    answers TEXT NOT NULL DEFAULT '[]',
    screenshot TEXT,
    url TEXT NOT NULL
  );
`)

const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile')
const RUNS_DIR = path.join(DATA_DIR, 'applications')

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function applyUrl(job: Pick<Job, 'ats' | 'url'>): string {
  const url = job.url.replace(/\/+$/, '')
  if (job.ats === 'Ashby') return url.endsWith('/application') ? url : `${url}/application`
  if (job.ats === 'Lever') return url.endsWith('/apply') ? url : `${url}/apply`
  return url
}

/** Never let a dry run send an application, whatever the page does. */
async function blockSubmissions(page: Page) {
  await page.route('**/*', (route) => {
    const req = route.request()
    const url = req.url()
    const looksLikeSubmit =
      req.method() === 'POST' &&
      ((req.isNavigationRequest() && req.resourceType() === 'document') ||
        /submit|\/applications?(\?|$)|\/apply(\?|$)/i.test(url))
    return looksLikeSubmit ? route.abort() : route.continue()
  })
}

async function pageGone(page: Page): Promise<boolean> {
  const html = await page.content()
  return (
    html.includes('"posting":null') ||
    /job (is )?no longer (available|open|accepting)|position has been filled|job not found|page not found/i.test(
      await page.locator('body').innerText().catch(() => ''),
    )
  )
}

interface RunResult {
  outcome: AgentRun['outcome']
  reasons: string[]
  decisions: Decision[]
  screenshot: string | null
}

async function runJob(context: BrowserContext, job: Job, ctx: JobContext): Promise<RunResult> {
  const page = await context.newPage()
  await blockSubmissions(page)
  const reasons: string[] = []
  const decisions: Decision[] = []
  const dir = path.join(RUNS_DIR, job.id)
  fs.mkdirSync(dir, { recursive: true })
  const screenshot = path.join(dir, `dry-run-${Date.now()}.png`)

  try {
    await page.goto(applyUrl(job), { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForSelector('input, textarea', { timeout: 20_000 }).catch(() => undefined)
    await pause(2000)
    if (await pageGone(page)) {
      db.prepare("UPDATE jobs SET live = 'closed', live_note = 'The application page says the job is gone', live_checked_at = ? WHERE id = ?").run(now(), job.id)
      return { outcome: 'closed', reasons: ['The posting is gone'], decisions, screenshot: null }
    }

    let fields: FormField[] = await page.evaluate(extractFields, 0)
    if (fields.length === 0) return { outcome: 'error', reasons: ['No form found on the page'], decisions, screenshot: null }

    for (const f of fields.filter((x) => x.kind === 'combobox' && x.options.length === 0)) {
      f.options = await readComboboxOptions(page, f)
    }

    for (const f of fields) {
      const d = await decide(f, ctx)
      decisions.push(d)
      if (d.park) {
        reasons.push(d.park)
        continue
      }
      if (d.values.length === 0) continue
      const problem = await fillField(page, d)
      if (problem) {
        d.note = problem
        if (f.required) reasons.push(`Could not fill "${f.label}": ${problem}`)
      }
    }

    // Some forms reveal extra questions after an answer (for example "If yes, explain").
    const extra = (await page.evaluate(extractFields, fields.length + 1000)).filter(
      (f) => !fields.some((g) => g.label === f.label && g.kind === f.kind),
    )
    for (const f of extra) {
      const d = await decide(f, ctx)
      decisions.push(d)
      if (d.park) reasons.push(d.park)
      else if (d.values.length) {
        const problem = await fillField(page, d)
        if (problem && f.required) reasons.push(`Could not fill "${f.label}": ${problem}`)
      }
    }
    fields = [...fields, ...extra]

    for (const label of await emptyRequired(page, fields)) {
      if (!reasons.some((r) => r.includes(label))) reasons.push(`Required field still empty: ${label}`)
    }

    if (await page.locator('iframe[src*="hcaptcha"], iframe[title*="challenge" i]').count()) {
      decisions.push({
        field: { id: '-', kind: 'text', label: 'Human check', required: false, options: [], hint: '' },
        values: [],
        source: null,
        note: 'This form has a CAPTCHA, which may stop an unattended submit',
      })
    }

    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined)
    return { outcome: reasons.length ? 'parked' : 'ready', reasons: [...new Set(reasons)], decisions, screenshot }
  } catch (err) {
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined)
    return {
      outcome: 'error',
      reasons: [err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : String(err)],
      decisions,
      screenshot: fs.existsSync(screenshot) ? screenshot : null,
    }
  } finally {
    await page.close().catch(() => undefined)
  }
}

// ── Batch control

const progress: AgentProgress = { running: false, mode: null, done: 0, total: 0, current: null, startedAt: null }
export const agentProgress = (): AgentProgress => ({ ...progress })

/** Picks jobs for a dry run: the best open ones across the three supported systems. */
export function pickDryRunJobs(limit: number): Job[] {
  const pick = db.prepare<[string, number], Job>(`
    SELECT * FROM jobs
    WHERE ats = ? AND mode = 'auto' AND status != 'applied' AND removed = 0 AND live != 'closed'
      AND dup_of IS NULL AND priority <= 3
      AND id NOT IN (SELECT job_id FROM runs)
    ORDER BY priority, last_checked DESC LIMIT ?
  `)
  const share = { Greenhouse: Math.ceil(limit * 0.4), Ashby: Math.ceil(limit * 0.4), Lever: Math.max(1, Math.floor(limit * 0.2)) }
  return Object.entries(share)
    .flatMap(([ats, n]) => pick.all(ats, n))
    .slice(0, limit)
}

export function startDryRun(limit = 10, jobIds: string[] = []): AgentProgress {
  if (progress.running) return agentProgress()
  const byId = db.prepare<[string], Job>('SELECT * FROM jobs WHERE id = ?')
  const jobs = jobIds.length ? jobIds.map((id) => byId.get(id)).filter((j): j is Job => Boolean(j)) : pickDryRunJobs(limit)
  Object.assign(progress, { running: true, mode: 'dry', done: 0, total: jobs.length, current: null, startedAt: now() })

  const insert = db.prepare("INSERT INTO runs (job_id, mode, started_at, url) VALUES (?, 'dry', ?, ?)")
  const finish = db.prepare('UPDATE runs SET finished_at = ?, outcome = ?, reasons = ?, answers = ?, screenshot = ? WHERE id = ?')

  void (async () => {
    let context: BrowserContext | null = null
    try {
      await syncResume()
      const resumePath = resumeInfo().pdf
      if (!resumePath) throw new Error('No resume PDF; sync the resume first')
      const answers = loadAnswers()
      fs.mkdirSync(PROFILE_DIR, { recursive: true })
      context = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: 'chrome',
        headless: false,
        viewport: { width: 1280, height: 900 },
      })
      // tsx keeps function names with a __name() helper; code sent into the page needs it too.
      await context.addInitScript('globalThis.__name = (fn) => fn')

      for (const job of jobs) {
        progress.current = `${job.company} · ${job.role}`
        const runId = Number(insert.run(job.id, now(), applyUrl(job)).lastInsertRowid)
        const drafts = db.prepare<[string], { label: string; value: string }>('SELECT label, value FROM drafts WHERE job_id = ?').all(job.id)
        const result = await runJob(context, job, {
          id: job.id,
          company: job.company,
          role: job.role,
          location: job.location || job.market,
          answers,
          drafts,
          resumePath,
        })
        const record = result.decisions.map((d) => ({
          question: d.field.label,
          kind: d.field.kind,
          required: d.field.required,
          answer: d.field.kind === 'file' ? d.values.map((v) => path.basename(v)) : d.values,
          source: d.source,
          note: d.park ?? d.note ?? null,
        }))
        finish.run(now(), result.outcome, JSON.stringify(result.reasons), JSON.stringify(record), result.screenshot, runId)
        fs.writeFileSync(path.join(RUNS_DIR, job.id, 'dry-run-answers.json'), JSON.stringify({ job: job.id, url: applyUrl(job), ...result, decisions: record }, null, 2))
        progress.done++
        await pause(1500)
      }
    } catch (err) {
      logEvent(null, 'agent_error', err instanceof Error ? err.message : String(err))
    } finally {
      await context?.close().catch(() => undefined)
      Object.assign(progress, { running: false, current: null })
      logEvent(null, 'dry_run', `${progress.done} of ${progress.total} jobs`)
    }
  })()
  return agentProgress()
}

interface RunRow {
  id: number
  job_id: string
  mode: string
  started_at: string
  finished_at: string | null
  outcome: AgentRun['outcome']
  reasons: string
  answers: string
  screenshot: string | null
  url: string
  company: string
  role: string
  ats: string
}

export function listRuns(limit = 100): AgentRun[] {
  return db
    .prepare<[number], RunRow>(`
      SELECT runs.*, jobs.company, jobs.role, jobs.ats FROM runs JOIN jobs ON jobs.id = runs.job_id
      ORDER BY runs.id DESC LIMIT ?
    `)
    .all(limit)
    .map((r) => ({
      id: r.id,
      jobId: r.job_id,
      company: r.company,
      role: r.role,
      ats: r.ats,
      mode: r.mode as AgentRun['mode'],
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      outcome: r.outcome,
      reasons: JSON.parse(r.reasons),
      answers: JSON.parse(r.answers),
      hasScreenshot: Boolean(r.screenshot && fs.existsSync(r.screenshot)),
      url: r.url,
    }))
}

export function runScreenshot(id: number): string | null {
  const row = db.prepare<[number], { screenshot: string | null }>('SELECT screenshot FROM runs WHERE id = ?').get(id)
  return row?.screenshot && fs.existsSync(row.screenshot) ? row.screenshot : null
}

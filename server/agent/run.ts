import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { DATA_DIR, db, getSetting, logEvent, now } from '../db.ts'
import { resumeInfo, syncResume } from '../resume.ts'
import { extractFields, type FormField } from './extract.ts'
import { emptyRequired, fillField, readComboboxOptions } from './fill.ts'
import { decide, loadAnswers, type Decision, type JobContext } from './resolve.ts'
import { submitAndConfirm } from './submit.ts'
import { notify, saveReport, summaryLine, type RunReport } from '../notify.ts'
import type { AgentProgress, AgentRun, Job } from '../../shared/types.ts'

// The application agent. A dry run fills real forms and stops before submitting:
// the code has no submit step in that mode, and as a second safety every request
// that looks like a submission is blocked at the network level.
//
// A live run fills the same way and, only when every required answer is safe,
// presses submit once. The job is marked "submitting" in the database before the
// click, so a crash can never lead to a second application; anything short of a
// clear confirmation leaves the job for the user rather than retrying.

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
if (!db.prepare<[], { name: string }>('PRAGMA table_info(runs)').all().some((c) => c.name === 'receipt')) {
  db.exec('ALTER TABLE runs ADD COLUMN receipt TEXT')
}

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

export interface RunResult {
  outcome: AgentRun['outcome']
  reasons: string[]
  decisions: Decision[]
  /** The filled form; after a live submit, the page the employer showed next. */
  screenshot: string | null
  /** Live runs: the filled form just before submit. */
  filledScreenshot?: string | null
  confirmation?: string | null
  /** True once the submit button has been pressed. */
  pressed?: boolean
}

export interface RunOptions {
  mode: 'dry' | 'live'
  /** Called right before submit; returning false cancels it. Marks the job as submitting. */
  beforeSubmit?: () => boolean
  confirmTimeoutMs?: number
}

export async function runJob(context: BrowserContext, job: Job, ctx: JobContext, options: RunOptions = { mode: 'dry' }): Promise<RunResult> {
  const page = await context.newPage()
  if (options.mode === 'dry') await blockSubmissions(page)
  const reasons: string[] = []
  const decisions: Decision[] = []
  const dir = path.join(RUNS_DIR, job.id)
  fs.mkdirSync(dir, { recursive: true })
  const screenshot = path.join(dir, `${options.mode === 'dry' ? 'dry-run' : 'filled'}-${Date.now()}.png`)
  let pressed = false

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
    if (reasons.length || options.mode === 'dry') {
      return { outcome: reasons.length ? 'parked' : 'ready', reasons: [...new Set(reasons)], decisions, screenshot }
    }

    // ── Live: every required answer is safe, so submit once.
    if (!options.beforeSubmit?.()) {
      return { outcome: 'parked', reasons: ['Skipped: this job was already applied to or is being submitted'], decisions, screenshot }
    }
    pressed = true
    const result = await submitAndConfirm(page, options.confirmTimeoutMs)
    const after = path.join(dir, `after-submit-${Date.now()}.png`)
    await page.screenshot({ path: after, fullPage: true }).catch(() => undefined)
    return {
      outcome: result.outcome,
      reasons: result.reasons,
      decisions,
      screenshot: fs.existsSync(after) ? after : screenshot,
      filledScreenshot: screenshot,
      confirmation: result.confirmation,
      pressed,
    }
  } catch (err) {
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined)
    return {
      // An error after pressing submit means the application may have gone through.
      pressed,
      outcome: pressed ? 'uncertain' : 'error',
      reasons: [err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : String(err)],
      decisions,
      screenshot: fs.existsSync(screenshot) ? screenshot : null,
    }
  } finally {
    await page.close().catch(() => undefined)
  }
}

// ── Batch control

const progress: AgentProgress = {
  running: false,
  mode: null,
  done: 0,
  total: 0,
  current: null,
  startedAt: null,
  stopping: false,
  message: null,
}
export const agentProgress = (): AgentProgress => ({ ...progress })

export const dailyCap = () => Math.max(1, Number(getSetting('daily_cap', '20')) || 20)

/** Applications confirmed today (local time). */
export function appliedToday(): number {
  return db
    .prepare<[], { n: number }>(
      "SELECT COUNT(*) AS n FROM runs WHERE mode = 'live' AND outcome = 'applied' AND date(started_at, 'localtime') = date('now', 'localtime')",
    )
    .get()!.n
}

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

/**
 * Jobs a live run may apply to: automatic ones, priority 1–3, never touched by
 * a live run before (status not_started), best first. Long shots wait for the user.
 */
export function pickLiveJobs(limit: number): Job[] {
  return db
    .prepare<[number], Job>(`
      SELECT * FROM jobs
      WHERE mode = 'auto' AND ats IN ('Greenhouse', 'Ashby', 'Lever') AND status = 'not_started'
        AND removed = 0 AND live != 'closed' AND dup_of IS NULL AND priority <= 3
      ORDER BY priority, CASE live WHEN 'open' THEN 0 ELSE 1 END, last_checked DESC
      LIMIT ?
    `)
    .all(limit)
}

export function readyForLive(): number {
  return pickLiveJobs(100000).length
}

export function stopAgent(): AgentProgress {
  if (progress.running) progress.stopping = true
  return agentProgress()
}

function writeReceipt(job: Job, runId: number, result: RunResult, record: unknown[], resumePath: string): string {
  const file = path.join(RUNS_DIR, job.id, `receipt-${runId}.json`)
  const submittedAt = new Date()
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        job_id: job.id,
        company: job.company,
        role: job.role,
        url: applyUrl(job),
        submitted_at: submittedAt.toISOString(),
        submitted_at_local: submittedAt.toString(),
        confirmation: result.confirmation,
        resume: { file: path.basename(resumePath), sha256: crypto.createHash('sha256').update(fs.readFileSync(resumePath)).digest('hex') },
        screenshots: { filled: result.filledScreenshot, after_submit: result.screenshot },
        answers: record,
      },
      null,
      2,
    ),
  )
  return file
}

function runBatch(mode: 'dry' | 'live', jobs: Job[], trigger: RunReport['trigger'] = 'manual') {
  Object.assign(progress, {
    running: true,
    mode,
    done: 0,
    total: jobs.length,
    current: null,
    startedAt: now(),
    stopping: false,
    message: null,
  })

  const insert = db.prepare('INSERT INTO runs (job_id, mode, started_at, url) VALUES (?, ?, ?, ?)')
  const finish = db.prepare('UPDATE runs SET finished_at = ?, outcome = ?, reasons = ?, answers = ?, screenshot = ?, receipt = ? WHERE id = ?')
  const setStatus = db.prepare('UPDATE jobs SET status = ?, applied_at = COALESCE(?, applied_at) WHERE id = ?')
  let applied = 0
  const report: RunReport = {
    startedAt: now(),
    finishedAt: now(),
    trigger,
    applied: [],
    needsYou: [],
    check: [],
    closed: 0,
    failed: 0,
    note: null,
  }

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

      for (const [i, job] of jobs.entries()) {
        if (progress.stopping) {
          progress.message = 'Stopped when you asked.'
          break
        }
        if (mode === 'live' && appliedToday() >= dailyCap()) {
          progress.message = `Reached today's limit of ${dailyCap()} applications.`
          break
        }

        progress.current = `${job.company} · ${job.role}`
        const runId = Number(insert.run(job.id, mode, now(), applyUrl(job)).lastInsertRowid)
        const drafts = db.prepare<[string], { label: string; value: string }>('SELECT label, value FROM drafts WHERE job_id = ?').all(job.id)

        // Claims the job just before submit; refuses if anything else already did.
        const beforeSubmit = () =>
          db.transaction(() => {
            const current = db.prepare<[string], { status: string }>('SELECT status FROM jobs WHERE id = ?').get(job.id)
            if (current?.status !== 'not_started') return false
            setStatus.run('submitting', null, job.id)
            db.prepare("UPDATE runs SET outcome = 'submitting' WHERE id = ?").run(runId)
            return true
          })()

        const result = await runJob(
          context,
          job,
          { id: job.id, company: job.company, role: job.role, location: job.location || job.market, answers, drafts, resumePath },
          { mode, beforeSubmit },
        )
        const record = result.decisions.map((d) => ({
          question: d.field.label,
          kind: d.field.kind,
          required: d.field.required,
          answer: d.field.kind === 'file' ? d.values.map((v) => path.basename(v)) : d.values,
          source: d.source,
          note: d.park ?? d.note ?? null,
        }))

        let receipt: string | null = null
        if (mode === 'live') {
          if (result.outcome === 'applied') {
            receipt = writeReceipt(job, runId, result, record, resumePath)
            setStatus.run('applied', now(), job.id)
            applied++
            report.applied.push({ company: job.company, role: job.role })
          } else if (result.outcome === 'uncertain') {
            setStatus.run('uncertain', null, job.id)
            report.check.push({ company: job.company, role: job.role })
          } else if (result.outcome === 'parked') {
            setStatus.run('needs_you', null, job.id)
            report.needsYou.push({ company: job.company, role: job.role, reason: result.reasons[0] ?? 'needs an answer' })
          } else if (result.outcome === 'error') {
            setStatus.run('failed', null, job.id)
            report.failed++
          } else if (result.outcome === 'closed') report.closed++
          logEvent(job.id, `live_${result.outcome}`, result.reasons.join('; '))
        } else {
          fs.writeFileSync(
            path.join(RUNS_DIR, job.id, 'dry-run-answers.json'),
            JSON.stringify({ job: job.id, url: applyUrl(job), ...result, decisions: record }, null, 2),
          )
        }
        finish.run(now(), result.outcome, JSON.stringify(result.reasons), JSON.stringify(record), result.screenshot, receipt, runId)
        progress.done++

        // A person-like pace between real applications; a stop request cuts it short.
        if (mode === 'live' && i < jobs.length - 1) {
          const wait = 60_000 + Math.random() * 60_000
          for (let t = 0; t < wait && !progress.stopping; t += 1000) await pause(1000)
        } else {
          await pause(1500)
        }
      }
    } catch (err) {
      progress.message = err instanceof Error ? err.message : String(err)
      logEvent(null, 'agent_error', progress.message)
    } finally {
      await context?.close().catch(() => undefined)
      if (mode === 'live') {
        // Why the run ended early, if it did ("Reached today's limit…", "Stopped when you asked.").
        report.note = progress.message
        report.finishedAt = now()
        const line = summaryLine(report)
        progress.message = report.note ? `${line}. ${report.note}` : `${line}.`
        try {
          saveReport(report)
        } catch {
          // The run itself is recorded in the database either way.
        }
        void notify(trigger === 'schedule' ? 'Auto Apply: daily run done' : 'Auto Apply: run done', progress.message)
      }
      Object.assign(progress, { running: false, current: null, stopping: false })
      logEvent(null, mode === 'live' ? 'live_run' : 'dry_run', `${progress.done} of ${progress.total} jobs, ${applied} applied`)
    }
  })()
}

export function startDryRun(limit = 10, jobIds: string[] = []): AgentProgress {
  if (progress.running) return agentProgress()
  const byId = db.prepare<[string], Job>('SELECT * FROM jobs WHERE id = ?')
  const jobs = jobIds.length ? jobIds.map((id) => byId.get(id)).filter((j): j is Job => Boolean(j)) : pickDryRunJobs(limit)
  runBatch('dry', jobs)
  return agentProgress()
}

/** Starts submitting real applications, up to what is left of today's limit. */
export function startLive(limit?: number, trigger: RunReport['trigger'] = 'manual'): AgentProgress {
  if (progress.running) return agentProgress()
  const left = dailyCap() - appliedToday()
  if (left <= 0) {
    progress.message = `Today's limit of ${dailyCap()} applications is already reached.`
    return agentProgress()
  }
  // A few extra in case some park; the limit is enforced before each job anyway.
  const jobs = pickLiveJobs(Math.min(limit ?? left, left) + 10)
  if (jobs.length === 0) {
    progress.message = 'No jobs are ready for automatic applying.'
    return agentProgress()
  }
  runBatch('live', jobs, trigger)
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
  receipt: string | null
  url: string
  company: string
  role: string
  ats: string
  job_status: string
}

export function listRuns(limit = 100): AgentRun[] {
  return db
    .prepare<[number], RunRow>(`
      SELECT runs.*, jobs.company, jobs.role, jobs.ats, jobs.status AS job_status FROM runs JOIN jobs ON jobs.id = runs.job_id
      ORDER BY runs.id DESC LIMIT ?
    `)
    .all(limit)
    .map((r) => ({
      id: r.id,
      jobId: r.job_id,
      jobStatus: r.job_status as AgentRun['jobStatus'],
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
      hasReceipt: Boolean(r.receipt && fs.existsSync(r.receipt)),
      url: r.url,
    }))
}

export function runScreenshot(id: number): string | null {
  const row = db.prepare<[number], { screenshot: string | null }>('SELECT screenshot FROM runs WHERE id = ?').get(id)
  return row?.screenshot && fs.existsSync(row.screenshot) ? row.screenshot : null
}

export function runReceipt(id: number): string | null {
  const row = db.prepare<[number], { receipt: string | null }>('SELECT receipt FROM runs WHERE id = ?').get(id)
  return row?.receipt && fs.existsSync(row.receipt) ? row.receipt : null
}

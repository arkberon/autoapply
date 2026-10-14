import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { APP_DIR, db, getSetting, logEvent, now, setSetting } from './db.ts'
import { runImport } from './import.ts'
import { DEFAULT_LLM_BASE_URL, llmConfig, testLlm } from './llm.ts'
import { QUESTIONS, SECTION_NOTES } from './questions.ts'
import { docIdFromUrl, resumeInfo, syncResume } from './resume.ts'
import { startVerify, verifyProgress } from './verify.ts'
import type { Answer, Job, LlmStatus, Summary } from '../shared/types.ts'

process.chdir(APP_DIR)

const app = new Hono()

const JOB_COLUMNS = `id, company, role, market, location, url, ats, mode, org, posting_id, fit, difficulty,
  priority, priority_reason, priority_locked, salary_low, salary_high, status, live, live_note, live_checked_at,
  last_checked, applied_at, dup_of, hold, notes, removed,
  (SELECT COUNT(*) FROM drafts d WHERE d.job_id = jobs.id) AS draft_count`

// Jobs with nothing left to do sink to the bottom. Within a priority level, the
// jobs the app can finish on its own come first.
const JOB_ORDER = `CASE WHEN status = 'applied' OR live = 'closed' THEN 1 ELSE 0 END, priority,
  CASE mode WHEN 'auto' THEN 0 WHEN 'review' THEN 1 WHEN 'assist' THEN 2 WHEN 'email' THEN 3 ELSE 4 END,
  last_checked DESC, company`

function counts(column: string): Record<string, number> {
  const rows = db.prepare<[], { k: string; n: number }>(`SELECT ${column} AS k, COUNT(*) AS n FROM jobs WHERE removed = 0 GROUP BY 1`).all()
  return Object.fromEntries(rows.map((r) => [String(r.k), r.n]))
}

function setupProgress(): Summary['setup'] {
  const answered = new Set(
    db.prepare<[], { key: string }>("SELECT key FROM answers WHERE TRIM(value) != ''").all().map((r) => r.key),
  )
  const required = QUESTIONS.filter((q) => q.required)
  const missing = required.filter((q) => !answered.has(q.key))
  return { answered: required.length - missing.length, required: required.length, missing: missing.map((q) => q.label) }
}

// Result of the last connection test, so the dashboard does not wake the model on every page load.
let llmStatus: LlmStatus = {
  baseUrl: llmConfig().baseUrl,
  model: llmConfig().model,
  ok: false,
  message: 'Not tested yet.',
  models: [],
}

async function refreshLlm(): Promise<LlmStatus> {
  llmStatus = await testLlm()
  return llmStatus
}

app.get('/api/summary', (c) => {
  const summary: Summary = {
    jobs: db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM jobs WHERE removed = 0').get()!.n,
    byPriority: counts('priority'),
    byMode: counts('mode'),
    byStatus: counts('status'),
    byLive: counts('live'),
    setup: setupProgress(),
    resume: resumeInfo(),
    llm: llmStatus,
    verify: verifyProgress(),
    lastChecked: db.prepare<[], { at: string | null }>('SELECT MAX(live_checked_at) AS at FROM jobs').get()!.at,
  }
  return c.json(summary)
})

app.get('/api/jobs', (c) => {
  return c.json(db.prepare<[], Job>(`SELECT ${JOB_COLUMNS} FROM jobs ORDER BY ${JOB_ORDER}`).all())
})

app.get('/api/jobs/:id', (c) => {
  const id = c.req.param('id')
  const job = db.prepare<[string], Job & { raw: string }>(`SELECT ${JOB_COLUMNS}, raw FROM jobs WHERE id = ?`).get(id)
  if (!job) return c.json({ error: 'Job not found' }, 404)
  const drafts = db.prepare<[string], { label: string; value: string }>('SELECT label, value FROM drafts WHERE job_id = ?').all(id)
  const { raw, ...rest } = job
  return c.json({ job: rest, drafts, sheet: JSON.parse(raw) })
})

const jobPatch = z.object({
  priority: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  // The only status a person sets by hand: "I applied to this one myself" and its undo.
  status: z.enum(['applied', 'not_started']).optional(),
  removed: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
})

app.patch('/api/jobs/:id', async (c) => {
  const id = c.req.param('id')
  const patch = jobPatch.safeParse(await c.req.json())
  if (!patch.success) return c.json({ error: 'Invalid change' }, 400)
  if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) return c.json({ error: 'Job not found' }, 404)

  const { priority, status, notes, removed } = patch.data
  if (priority !== undefined) {
    db.prepare("UPDATE jobs SET priority = ?, priority_locked = 1, priority_reason = 'Set by you' WHERE id = ?").run(priority, id)
  }
  if (status !== undefined) {
    db.prepare('UPDATE jobs SET status = ?, applied_at = ? WHERE id = ?').run(status, status === 'applied' ? now() : null, id)
    logEvent(id, 'status', `${status} (set by hand)`)
  }
  if (notes !== undefined) db.prepare('UPDATE jobs SET notes = ? WHERE id = ?').run(notes, id)
  if (removed !== undefined) {
    db.prepare('UPDATE jobs SET removed = ? WHERE id = ?').run(removed ? 1 : 0, id)
    logEvent(id, removed ? 'removed' : 'restored')
  }
  return c.json(db.prepare<[string], Job>(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`).get(id))
})

app.get('/api/questions', (c) => {
  const answers = db.prepare<[], Answer>('SELECT key, value, source, updated_at FROM answers').all()
  return c.json({ questions: QUESTIONS, sectionNotes: SECTION_NOTES, answers })
})

app.put('/api/answers/:key', async (c) => {
  const key = c.req.param('key')
  const question = QUESTIONS.find((q) => q.key === key)
  const body = z.object({ value: z.string().max(4000) }).safeParse(await c.req.json())
  if (!question || !body.success) return c.json({ error: 'Unknown question' }, 400)

  const value = body.data.value.trim()
  if (value && question.options && !question.options.includes(value)) return c.json({ error: 'Not one of the choices' }, 400)
  db.prepare(`
    INSERT INTO answers (key, value, source, updated_at) VALUES (?, ?, 'you', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, source = 'you', updated_at = excluded.updated_at
  `).run(key, value, now())
  return c.json({ setup: setupProgress() })
})

app.post('/api/import', (c) => c.json(runImport()))

app.get('/api/verify', (c) => c.json(verifyProgress()))
app.post('/api/verify', (c) => c.json(startVerify()))

app.get('/api/resume', (c) => c.json(resumeInfo()))
app.post('/api/resume/sync', async (c) => c.json(await syncResume()))
app.get('/api/resume/file', (c) => {
  const { pdf } = resumeInfo()
  if (!pdf) return c.json({ error: 'No resume synced yet' }, 404)
  return c.body(fs.readFileSync(pdf), 200, {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="${path.basename(pdf)}"`,
  })
})

const settingsBody = z.object({
  resumeDocUrl: z.string().max(500).optional(),
  llmBaseUrl: z.string().max(300).optional(),
  llmModel: z.string().max(200).optional(),
})

app.get('/api/settings', (c) => {
  return c.json({
    resumeDocUrl: getSetting('resume_doc_url'),
    llmBaseUrl: getSetting('llm_base_url', DEFAULT_LLM_BASE_URL),
    llmModel: getSetting('llm_model'),
  })
})

app.put('/api/settings', async (c) => {
  const body = settingsBody.safeParse(await c.req.json())
  if (!body.success) return c.json({ error: 'Invalid settings' }, 400)
  const { resumeDocUrl, llmBaseUrl, llmModel } = body.data

  if (resumeDocUrl !== undefined) {
    const id = docIdFromUrl(resumeDocUrl)
    if (resumeDocUrl.trim() && !id) return c.json({ error: 'That does not look like a Google Docs link.' }, 400)
    // Store the bare document link; a pasted share link can carry the owner's account id.
    setSetting('resume_doc_url', id ? `https://docs.google.com/document/d/${id}/edit` : '')
  }
  if (llmBaseUrl !== undefined) setSetting('llm_base_url', llmBaseUrl.trim() || DEFAULT_LLM_BASE_URL)
  if (llmModel !== undefined) setSetting('llm_model', llmModel.trim())
  if (llmBaseUrl !== undefined || llmModel !== undefined) await refreshLlm()
  return c.json({ ok: true })
})

app.post('/api/llm/test', async (c) => c.json(await refreshLlm()))

// The built dashboard. In development Vite serves it instead and proxies /api here.
app.use('/*', serveStatic({ root: './dist' }))
app.get('/*', serveStatic({ path: './dist/index.html' }))

if (db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM jobs').get()!.n === 0) {
  const result = runImport()
  console.log(`Imported ${result.jobs} jobs from the job sheet.`)
}
void syncResume()
void refreshLlm()

const port = Number(process.env.PORT ?? 4310)
// Bound to this machine only: the database holds personal answers.
const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Auto Apply is running at http://localhost:${port}`)
})
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  console.log(`Auto Apply is already running. Open http://localhost:${port}`)
  process.exit(0)
})

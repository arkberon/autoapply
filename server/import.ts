import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, KIT_DIR, logEvent, now } from './db.ts'
import { detectTarget } from './ats.ts'
import { computePriority } from './priority.ts'
import { DEFAULTS } from './questions.ts'

interface KitJob {
  job_id: string
  company: string
  role: string
  market?: string
  location?: string
  application_url: string
  resume_fit?: string
  difficulty_estimate?: string
  salary_low_usd?: number | null
  salary_high_usd?: number | null
  application_status?: string
  applied_date?: string | null
  last_checked?: string | null
  user_notes?: string | null
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

function findAnswerFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => path.basename(p) === 'answers.json')
    .map((p) => path.join(dir, p))
}

/** Turns the kit's applicant profile into answers for the setup questions. */
function profileAnswers(profile: any): Record<string, string> {
  const field = (name: string): string => {
    const v = profile?.fields?.[name]?.value
    return v === null || v === undefined ? '' : String(v)
  }
  const out: Record<string, string> = {}

  const [first, ...rest] = field('Full name').trim().split(/\s+/)
  out.first_name = first ?? ''
  out.last_name = rest.join(' ')
  out.email = field('Email')
  out.phone = field('Phone')

  const [city, state] = field('Current city / state').split(',').map((s) => s.trim())
  out.city = city ?? ''
  out.state = state ?? ''

  out.linkedin = field('LinkedIn')
  out.portfolio = field('Portfolio URL')
  out.github = field('GitHub URL')
  out.school = field('School')

  const degree = field('Degree / major')
  const bs = degree.match(/^B\.?S\.?\s+(.*)$/i)
  out.degree = bs ? 'Bachelor of Science' : degree
  out.major = bs ? bs[1] : ''
  out.graduation = field('Graduation month')

  out.work_authorized = field('Authorized to work in US?')
  out.sponsorship_now = field('Sponsorship needed now?')
  out.sponsorship_future = field('Sponsorship needed in future?')

  const relocate = [field('Relocate to NYC?'), field('Relocate to LA?')]
  if (relocate.every((r) => r === 'Yes')) out.relocate = 'Yes'
  if (field('Maximum office days / week') === '5') out.onsite_ok = 'Yes'

  const current = profile?.verified_resume_facts?.employment?.find((e: any) => e.end === 'Present')
  if (current) {
    out.current_employer = current.employer ?? ''
    out.current_title = current.title ?? ''
  }
  return out
}

export function runImport(): { jobs: number; added: number; drafts: number; seeded: number } {
  const kit = readJson<{ jobs: KitJob[] }>(path.join(KIT_DIR, 'jobs.json'))
  const profile = readJson<any>(path.join(KIT_DIR, 'applicant_profile.json'))

  const exists = db.prepare<[string], { id: string }>('SELECT id FROM jobs WHERE id = ?')
  const insert = db.prepare(`
    INSERT INTO jobs (id, company, role, market, location, url, ats, mode, org, posting_id, fit, difficulty,
      priority, priority_reason, salary_low, salary_high, status, last_checked, applied_at, hold, notes, raw)
    VALUES (@id, @company, @role, @market, @location, @url, @ats, @mode, @org, @posting_id, @fit, @difficulty,
      @priority, @priority_reason, @salary_low, @salary_high, @status, @last_checked, @applied_at, @hold, @notes, @raw)
  `)
  // A re-import refreshes facts from the sheet but never touches progress made in
  // the app: status, live checks, and any priority the user set by hand.
  const update = db.prepare(`
    UPDATE jobs SET company = @company, role = @role, market = @market, location = @location, url = @url,
      ats = @ats, mode = @mode, org = @org, posting_id = @posting_id, fit = @fit, difficulty = @difficulty,
      priority = CASE WHEN priority_locked = 1 THEN priority ELSE @priority END,
      priority_reason = CASE WHEN priority_locked = 1 THEN priority_reason ELSE @priority_reason END,
      salary_low = @salary_low, salary_high = @salary_high, last_checked = @last_checked, hold = @hold, raw = @raw
    WHERE id = @id
  `)
  const upsertDraft = db.prepare(`
    INSERT INTO drafts (job_id, label, value) VALUES (?, ?, ?)
    ON CONFLICT(job_id, label) DO UPDATE SET value = excluded.value
  `)
  const hasAnswer = db.prepare<[string], { key: string }>('SELECT key FROM answers WHERE key = ?')
  const seedAnswer = db.prepare('INSERT INTO answers (key, value, source, updated_at) VALUES (?, ?, ?, ?)')

  let added = 0
  let drafts = 0
  let seeded = 0

  db.transaction(() => {
    for (const j of kit.jobs) {
      const target = detectTarget(j.application_url)
      const p = computePriority(j.resume_fit ?? '', j.difficulty_estimate ?? '')
      const row = {
        id: j.job_id,
        company: j.company,
        role: j.role,
        market: j.market ?? '',
        location: j.location ?? '',
        url: j.application_url,
        ats: target.ats,
        mode: target.mode,
        org: target.org,
        posting_id: target.postingId,
        fit: j.resume_fit ?? '',
        difficulty: j.difficulty_estimate ?? '',
        priority: p.priority,
        priority_reason: p.reason,
        salary_low: j.salary_low_usd ?? null,
        salary_high: j.salary_high_usd ?? null,
        status: j.application_status === 'Applied' ? 'applied' : 'not_started',
        last_checked: j.last_checked ?? null,
        applied_at: j.applied_date ?? null,
        hold: p.hold ? 1 : 0,
        notes: j.user_notes ?? '',
        raw: JSON.stringify(j),
      }
      if (exists.get(j.job_id)) {
        update.run(row)
      } else {
        insert.run(row)
        added++
      }
    }

    // Two sheet rows that point at the same hosted posting must never both be submitted.
    db.prepare('UPDATE jobs SET dup_of = NULL').run()
    db.prepare(`
      UPDATE jobs SET dup_of = (
        SELECT MIN(o.id) FROM jobs o
        WHERE o.ats = jobs.ats AND o.org = jobs.org AND o.posting_id = jobs.posting_id AND o.id < jobs.id
      )
      WHERE org IS NOT NULL AND posting_id IS NOT NULL
    `).run()

    for (const file of findAnswerFiles(path.join(KIT_DIR, 'review_batches'))) {
      const a = readJson<any>(file)
      if (!a.job_id || !exists.get(a.job_id)) continue
      const written = { ...(a.draft_answers ?? {}), ...(a.role_specific_answers ?? {}) }
      for (const [label, value] of Object.entries(written)) {
        if (typeof value !== 'string' || !value.trim()) continue
        upsertDraft.run(a.job_id, label, value)
        drafts++
      }
    }

    const fromResume = profileAnswers(profile)
    for (const [key, value] of Object.entries(fromResume)) {
      if (!value || hasAnswer.get(key)) continue
      seedAnswer.run(key, value, 'resume', now())
      seeded++
    }
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (hasAnswer.get(key)) continue
      seedAnswer.run(key, value, 'default', now())
      seeded++
    }
  })()

  logEvent(null, 'import', `${kit.jobs.length} jobs, ${added} new, ${drafts} drafts`)
  return { jobs: kit.jobs.length, added, drafts, seeded }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(runImport())
}

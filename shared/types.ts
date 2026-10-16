// Types shared by the server and the dashboard.

/** How the app gets an application submitted for a given link. */
export type Mode = 'auto' | 'review' | 'assist' | 'manual' | 'email'

export type Live = 'open' | 'closed' | 'unknown'

/** Work areas a job can be sorted into. */
export const WORK_AREAS = [
  'Software engineering',
  'IT',
  'QA & testing',
  'Technical support',
  'Customer support',
  'Data & analytics',
  'Field engineering',
  'Construction',
  'Clerical & admin',
  'Implementation & onboarding',
  'Sales & business',
  'Design',
  'Other',
] as const

export type WorkArea = (typeof WORK_AREAS)[number]

export type Status =
  | 'not_started'
  | 'queued'
  | 'needs_review'
  | 'needs_you'
  | 'submitting'
  | 'applied'
  | 'uncertain'
  | 'failed'

export type Priority = 1 | 2 | 3 | 4

export interface Job {
  id: string
  company: string
  role: string
  market: string
  location: string
  url: string
  ats: string
  mode: Mode
  org: string | null
  posting_id: string | null
  fit: string
  difficulty: string
  priority: Priority
  priority_reason: string
  priority_locked: 0 | 1
  salary_low: number | null
  salary_high: number | null
  status: Status
  live: Live
  live_note: string
  live_checked_at: string | null
  last_checked: string | null
  applied_at: string | null
  dup_of: string | null
  hold: 0 | 1
  notes: string
  /** Taken off the list by the user; kept so a re-import does not bring it back. */
  removed: 0 | 1
  /** Set when the job was found on a company board by the app rather than imported from the sheet. */
  discovered_at: string | null
  /** Filled in automatically when the job is added; null only until classification runs. */
  area: WorkArea | null
  /** rule, model or you. */
  area_source: string | null
  draft_count: number
}

export type QuestionType = 'text' | 'textarea' | 'select' | 'number' | 'url' | 'email' | 'tel'

export interface Question {
  key: string
  section: string
  label: string
  help?: string
  type: QuestionType
  options?: string[]
  placeholder?: string
  /** Counts toward "setup complete". Optional questions can stay blank. */
  required: boolean
}

export interface Answer {
  key: string
  value: string
  /** 'you' = typed in the app, 'resume' = imported from the profile, 'default' = safe default. */
  source: 'you' | 'resume' | 'default'
  updated_at: string
}

export interface ResumeInfo {
  docUrl: string
  pdf: string | null
  docx: string | null
  sha256: string | null
  syncedAt: string | null
  changedAt: string | null
  error: string | null
}

export interface LlmStatus {
  baseUrl: string
  model: string
  ok: boolean
  message: string
  models: string[]
}

export interface VerifyProgress {
  running: boolean
  done: number
  total: number
  startedAt: string | null
  finishedAt: string | null
}

export interface DiscoverProgress {
  running: boolean
  done: number
  total: number
  added: number
  failed: number
  finishedAt: string | null
  lastAdded: number
}

export interface DiscoverSettings {
  /** Comma-separated words; a title must contain at least one. */
  include: string
  /** Comma-separated words; a title containing any of them is skipped. */
  exclude: string
  /** Comma-separated places; the posting's location must mention one. */
  locations: string
  maxAgeDays: number
}

export interface PageLink {
  url: string
  text: string
}

/** A saved career page that lists several jobs and changes over time. */
export interface SavedPage {
  id: number
  url: string
  name: string
  note: string
  addedAt: string
  checkedAt: string | null
  /** When a check last found links that were not there before. */
  changedAt: string | null
  error: string
  linkCount: number
  /** Links added since the user last marked the page as seen. */
  newLinks: (PageLink & { onList: boolean })[]
}

export interface AgentProgress {
  running: boolean
  mode: 'dry' | 'live' | null
  done: number
  total: number
  /** "Company · Role" of the job being worked on. */
  current: string | null
  startedAt: string | null
}

export interface AgentAnswer {
  question: string
  kind: string
  required: boolean
  answer: string[]
  /** Where the answer came from: saved, draft, model, rule or resume-file. */
  source: string | null
  note: string | null
}

export interface AgentRun {
  id: number
  jobId: string
  company: string
  role: string
  ats: string
  mode: 'dry' | 'live'
  startedAt: string
  finishedAt: string | null
  /** ready = would submit; parked = needs you; closed = posting gone. */
  outcome: 'running' | 'ready' | 'parked' | 'closed' | 'error' | 'applied'
  reasons: string[]
  answers: AgentAnswer[]
  hasScreenshot: boolean
  url: string
}

export interface Summary {
  jobs: number
  byPriority: Record<string, number>
  byMode: Record<string, number>
  byStatus: Record<string, number>
  byLive: Record<string, number>
  byArea: Record<string, number>
  setup: { answered: number; required: number; missing: string[] }
  resume: ResumeInfo
  llm: LlmStatus
  verify: VerifyProgress
  discover: DiscoverProgress & { boards: number; found: number }
  pages: { followed: number; withNew: number }
  /** When posting status was last checked; survives restarts, unlike the in-memory progress. */
  lastChecked: string | null
}

export const MODE_LABEL: Record<Mode, string> = {
  auto: 'Automatic',
  review: 'Review first',
  assist: 'Needs your login',
  manual: 'You apply, app helps',
  email: 'Email draft',
}

export const MODE_HELP: Record<Mode, string> = {
  auto: 'The app fills and submits on its own once every answer is confirmed.',
  review: 'The app fills the form, then waits for your one-click approval.',
  assist: 'You sign in to the employer site once; the app fills the pages.',
  manual: 'This site does not allow bots. The app opens it with your answers ready to paste.',
  email: 'The app drafts the email and attaches your resume; you press send.',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: 'Apply first',
  2: 'Good chance',
  3: 'Stretch',
  4: 'Long shot',
}

export const STATUS_LABEL: Record<Status, string> = {
  not_started: 'Not started',
  queued: 'Queued',
  needs_review: 'Needs your review',
  needs_you: 'Needs you',
  submitting: 'Submitting',
  applied: 'Applied',
  uncertain: 'Check result',
  failed: 'Failed',
}

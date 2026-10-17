import type {
  AgentProgress,
  Dashboard,
  AgentRun,
  Answer,
  DiscoverProgress,
  DiscoverSettings,
  Job,
  LlmStatus,
  Question,
  PageLink,
  ResumeInfo,
  ScheduleSettings,
  SavedPage,
  Summary,
  VerifyProgress,
} from '../shared/types.ts'

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}

export interface JobDetail {
  job: Job
  drafts: { label: string; value: string }[]
  sheet: Record<string, unknown>
}

export interface Settings {
  resumeDocUrl: string
  llmBaseUrl: string
  llmModel: string
}

export const api = {
  summary: () => request<Summary>('/summary'),
  dashboard: () => request<Dashboard>('/dashboard'),
  jobs: () => request<Job[]>('/jobs'),
  job: (id: string) => request<JobDetail>(`/jobs/${id}`),
  patchJob: (
    id: string,
    patch: Partial<Pick<Job, 'priority' | 'notes' | 'area'>> & { status?: 'applied' | 'not_started'; removed?: boolean },
  ) =>
    request<Job>(`/jobs/${id}`, 'PATCH', patch),
  removeJobs: (ids: string[]) => request<{ removed: number }>('/jobs/remove', 'POST', { ids }),
  pages: () => request<SavedPage[]>('/pages'),
  addPage: (url: string, name = '', note = '') => request<SavedPage>('/pages', 'POST', { url, name, note }),
  updatePage: (id: number, patch: { name?: string; note?: string }) => request<SavedPage>(`/pages/${id}`, 'PATCH', patch),
  deletePage: (id: number) => request<{ ok: true }>(`/pages/${id}`, 'DELETE'),
  checkPage: (id: number) => request<SavedPage>(`/pages/${id}/check`, 'POST'),
  checkAllPages: () => request<SavedPage[]>('/pages/check', 'POST'),
  markPageSeen: (id: number) => request<SavedPage>(`/pages/${id}/seen`, 'POST'),
  addLinkAsJob: (id: number, link: PageLink) => request<{ id: string; added: boolean }>(`/pages/${id}/add-job`, 'POST', link),
  agent: () =>
    request<{ progress: AgentProgress; runs: AgentRun[]; today: { applied: number; cap: number; ready: number } }>('/agent'),
  startLive: () => request<AgentProgress>('/agent/live', 'POST', {}),
  stopAgent: () => request<AgentProgress>('/agent/stop', 'POST'),
  schedule: () => request<ScheduleSettings>('/schedule'),
  saveSchedule: (patch: Partial<ScheduleSettings>) => request<ScheduleSettings>('/schedule', 'PUT', patch),
  testNotify: () => request<{ shown: boolean }>('/notify/test', 'POST'),
  setDailyCap: (dailyCap: number) => request<{ cap: number }>('/agent/settings', 'PUT', { dailyCap }),
  startDryRun: (limit = 10) => request<AgentProgress>('/agent/dry-run', 'POST', { limit }),
  questions: () =>
    request<{ questions: Question[]; sectionNotes: Record<string, string>; answers: Answer[] }>('/questions'),
  saveAnswer: (key: string, value: string) => request<{ setup: Summary['setup'] }>(`/answers/${key}`, 'PUT', { value }),
  reimport: () => request<{ jobs: number; added: number }>('/import', 'POST'),
  startVerify: () => request<VerifyProgress>('/verify', 'POST'),
  startDiscover: () => request<DiscoverProgress>('/discover', 'POST'),
  discoverSettings: () => request<DiscoverSettings & { defaults: DiscoverSettings }>('/discover/settings'),
  saveDiscoverSettings: (settings: Partial<DiscoverSettings>) => request<DiscoverSettings>('/discover/settings', 'PUT', settings),
  addBoard: (url: string) => request<{ board: { ats: string; org: string }; boards: number }>('/discover/boards', 'POST', { url }),
  syncResume: () => request<ResumeInfo>('/resume/sync', 'POST'),
  settings: () => request<Settings>('/settings'),
  saveSettings: (settings: Partial<Settings>) => request<{ ok: true }>('/settings', 'PUT', settings),
  testLlm: () => request<LlmStatus>('/llm/test', 'POST'),
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

import type {
  Answer,
  DiscoverProgress,
  DiscoverSettings,
  Job,
  LlmStatus,
  Question,
  ResumeInfo,
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
  jobs: () => request<Job[]>('/jobs'),
  job: (id: string) => request<JobDetail>(`/jobs/${id}`),
  patchJob: (
    id: string,
    patch: Partial<Pick<Job, 'priority' | 'notes'>> & { status?: 'applied' | 'not_started'; removed?: boolean },
  ) =>
    request<Job>(`/jobs/${id}`, 'PATCH', patch),
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

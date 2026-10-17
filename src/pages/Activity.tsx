import { useCallback, useEffect, useState } from 'react'
import type { AgentProgress, AgentRun, ScheduleSettings } from '../../shared/types.ts'
import { api, timeAgo } from '../api.ts'
import { LiveRun } from './LiveRun.tsx'

const OUTCOME: Record<AgentRun['outcome'], { label: string; tone: string }> = {
  running: { label: 'Working…', tone: '' },
  ready: { label: 'Ready to submit', tone: 'ok' },
  submitting: { label: 'Submitting…', tone: '' },
  applied: { label: 'Applied', tone: 'ok' },
  parked: { label: 'Needs you', tone: 'warn' },
  uncertain: { label: 'Check result', tone: 'warn' },
  closed: { label: 'Posting closed', tone: '' },
  error: { label: 'Something went wrong', tone: 'warn' },
}

const SOURCE: Record<string, string> = {
  saved: 'Your answer',
  draft: 'Drafted earlier',
  model: 'Written by the model',
  rule: 'Rule',
  'resume-file': 'Your resume',
}

const CAPS = [5, 10, 20, 30]

function when(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' })
}

function Schedule({ cap }: { cap: number }) {
  const [s, setS] = useState<ScheduleSettings | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    api.schedule().then(setS)
    const timer = setInterval(() => api.schedule().then(setS), 15_000)
    return () => clearInterval(timer)
  }, [])

  if (!s) return null

  const save = async (patch: Partial<ScheduleSettings>) => setS(await api.saveSchedule(patch))

  const toggle = async (enabled: boolean) => {
    if (
      enabled &&
      !window.confirm(
        `Every ${s.weekdaysOnly ? 'weekday' : 'day'} at ${s.time} the app will apply for real to up to ${cap} jobs, ` +
          'without asking first. Turn the daily schedule on?',
      )
    ) {
      return
    }
    await save({ enabled })
  }

  const test = async () => {
    const { shown } = await api.testNotify()
    setNote(shown ? 'Sent. If nothing appeared, allow notifications for Script Editor in System Settings → Notifications.' : 'Notifications are off, or this is not a Mac.')
  }

  return (
    <section className="card schedule">
      <div className="schedule-head">
        <div>
          <strong>Daily schedule</strong>
          <span className="muted small">
            {s.running
              ? `Running now: ${s.step ?? 'starting'}…`
              : s.enabled
                ? `On. Next run ${when(s.nextRun)}.${s.lastRun ? ` Last ran ${s.lastRun}.` : ''}`
                : 'Off. Turn it on to have the app find, check and apply every day by itself.'}
          </span>
        </div>
        <label className="switch">
          <input type="checkbox" checked={s.enabled} onChange={(e) => toggle(e.target.checked)} />
          {s.enabled ? 'On' : 'Off'}
        </label>
      </div>

      <div className="schedule-options">
        <label className="check">
          Every
          <select value={s.weekdaysOnly ? 'weekdays' : 'daily'} onChange={(e) => save({ weekdaysOnly: e.target.value === 'weekdays' })}>
            <option value="weekdays">weekday</option>
            <option value="daily">day</option>
          </select>
          at
          <input type="time" value={s.time} onChange={(e) => e.target.value && save({ time: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.findFirst} onChange={(e) => save({ findFirst: e.target.checked })} />
          Find new jobs and re-check postings first
        </label>
        <label className="check">
          <input type="checkbox" checked={s.notify} onChange={(e) => save({ notify: e.target.checked })} />
          Notify me when a run finishes
        </label>
        <button onClick={test}>Send a test notification</button>
      </div>
      {note && <p className="muted small">{note}</p>}
      <p className="muted small">
        The app has to be open and your Mac awake at that time. If you open it later in the day, the day's run starts then.
        Each run saves a short report in <code>data/reports</code>.
      </p>
    </section>
  )
}

function RunCard({ run, onRetry }: { run: AgentRun; onRetry: () => void }) {
  const outcome = OUTCOME[run.outcome]
  const filled = run.answers.filter((a) => a.answer.length > 0)
  const written = run.answers.filter((a) => a.source === 'model' && a.kind === 'textarea').length
  // A live run that did not end in an application can be retried once the job is free again.
  const canRetry =
    run.mode === 'live' && ['parked', 'uncertain', 'error'].includes(run.outcome) && ['needs_you', 'uncertain', 'failed'].includes(run.jobStatus)

  const retry = async () => {
    const warning =
      run.outcome === 'uncertain'
        ? 'The agent pressed submit but saw no confirmation. Check your email and the employer site first: if the application went through, trying again would apply twice. Try again anyway?'
        : 'Put this job back in the queue for the next run?'
    if (!window.confirm(warning)) return
    await api.patchJob(run.jobId, { status: 'not_started' })
    onRetry()
  }

  return (
    <section className="card run">
      <div className="run-head">
        <div>
          <h2>
            {run.company}
            <span className={`tag ${outcome.tone}`}>{outcome.label}</span>
          </h2>
          <span className="muted small">
            {run.role} · {run.ats} · {run.mode === 'dry' ? 'dry run' : 'live'} {timeAgo(run.startedAt)}
          </span>
        </div>
        <div className="page-actions">
          {run.hasReceipt && (
            <a className="button" href={`/api/agent/runs/${run.id}/receipt`} target="_blank" rel="noreferrer">
              Receipt
            </a>
          )}
          {run.hasScreenshot && (
            <a className="button" href={`/api/agent/runs/${run.id}/screenshot`} target="_blank" rel="noreferrer">
              Screenshot
            </a>
          )}
          <a className="button" href={run.url} target="_blank" rel="noreferrer">
            Open form
          </a>
          {canRetry && <button onClick={retry}>Try again</button>}
        </div>
      </div>

      {run.reasons.length > 0 && (
        <ul className="reasons">
          {run.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {run.answers.length > 0 && (
        <details>
          <summary>
            {filled.length} of {run.answers.length} questions answered
            {written > 0 ? ` · ${written} written by the model` : ''}
          </summary>
          <table className="answers">
            <tbody>
              {run.answers.map((a, i) => (
                <tr key={i}>
                  <td>
                    {a.question}
                    {a.required && <span className="muted"> *</span>}
                  </td>
                  <td>
                    {a.answer.length ? a.answer.join(', ') : <span className="muted">Left empty</span>}
                    {a.note && <span className="muted small">{a.note}</span>}
                  </td>
                  <td>{a.source && <span className="tag">{SOURCE[a.source] ?? a.source}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  )
}

export function Activity() {
  const [progress, setProgress] = useState<AgentProgress | null>(null)
  const [runs, setRuns] = useState<AgentRun[]>([])
  const [today, setToday] = useState({ applied: 0, cap: 20, ready: 0 })
  const [filter, setFilter] = useState<'all' | 'live' | 'dry'>('all')

  const load = useCallback(async () => {
    const data = await api.agent()
    setProgress(data.progress)
    setRuns(data.runs)
    setToday(data.today)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!progress?.running) return
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [progress?.running, load])

  if (!progress) return null

  const left = Math.max(0, today.cap - today.applied)
  const live = progress.running && progress.mode === 'live'

  const startLive = async () => {
    const n = Math.min(left, today.ready)
    const ok = window.confirm(
      `The agent will submit real applications to up to ${n} employers now, using your saved answers and your resume. ` +
        'Jobs it cannot answer safely are left for you. Continue?',
    )
    if (!ok) return
    setProgress(await api.startLive())
    void load()
  }

  const startDry = async () => {
    setProgress(await api.startDryRun(10))
    void load()
  }

  const setCap = async (cap: number) => {
    await api.setDailyCap(cap)
    void load()
  }

  const shown = runs.filter((r) => filter === 'all' || r.mode === filter)
  const count = (outcome: AgentRun['outcome']) => runs.filter((r) => r.mode === 'live' && r.outcome === outcome).length

  return (
    <>
      <h1>Activity</h1>
      <p className="lead">
        What the application agent did, job by job: every answer it gave, where each answer came from, a screenshot, and
        a receipt for every application it sent.
      </p>

      <LiveRun progress={progress} runs={runs} onStop={async () => setProgress(await api.stopAgent())} />

      <section className="card find">
        <div>
          <strong>Apply automatically</strong>
          <span className="muted small">
            {live
              ? progress.stopping
                ? `Finishing ${progress.current ?? 'the current application'}, then stopping.`
                : `Applying to ${progress.current ?? '…'} (${progress.done + 1} of up to ${progress.total}). A Chrome window shows it working; it pauses a minute or two between applications.`
              : `${today.ready} jobs ready · ${today.applied} of ${today.cap} applied today. Priorities 1–3 on Ashby, Greenhouse and Lever; anything it can't answer safely waits for you.`}
          </span>
        </div>
        <label className="cap">
          Daily limit
          <select value={today.cap} onChange={(e) => setCap(Number(e.target.value))} disabled={live}>
            {[...new Set([...CAPS, today.cap])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {live ? (
          <button onClick={async () => setProgress(await api.stopAgent())} disabled={progress.stopping}>
            {progress.stopping ? 'Stopping…' : 'Stop after this one'}
          </button>
        ) : (
          <button className="primary" onClick={startLive} disabled={progress.running || left === 0 || today.ready === 0}>
            {left === 0 ? 'Limit reached today' : 'Start applying'}
          </button>
        )}
      </section>

      <Schedule cap={today.cap} />

      <section className="card find">
        <div>
          <strong>Dry run</strong>
          <span className="muted small">
            {progress.running && progress.mode === 'dry'
              ? `Filling ${progress.current ?? '…'} (${progress.done + 1} of ${progress.total}).`
              : 'Fills 10 forms exactly as the agent would, then stops before submitting. Nothing is sent to employers.'}
          </span>
        </div>
        <button onClick={startDry} disabled={progress.running}>
          {progress.running && progress.mode === 'dry' ? 'Running…' : 'Dry run 10'}
        </button>
      </section>

      {progress.message && !progress.running && <p className="banner ok">{progress.message}</p>}

      {runs.length > 0 && (
        <div className="views" role="tablist">
          {(
            [
              ['all', 'All runs'],
              ['live', `Live · ${count('applied')} applied, ${count('parked') + count('uncertain')} need you`],
              ['dry', 'Dry runs'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} role="tab" aria-selected={filter === v} className={filter === v ? 'view active' : 'view'} onClick={() => setFilter(v)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {shown.map((run) => (
        <RunCard key={run.id} run={run} onRetry={load} />
      ))}
      {runs.length === 0 && !progress.running && <p className="empty muted">No runs yet.</p>}
    </>
  )
}

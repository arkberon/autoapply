import { useCallback, useEffect, useState } from 'react'
import type { AgentProgress, AgentRun } from '../../shared/types.ts'
import { api, timeAgo } from '../api.ts'

const OUTCOME: Record<AgentRun['outcome'], { label: string; tone: string }> = {
  running: { label: 'Working…', tone: '' },
  ready: { label: 'Ready to submit', tone: 'ok' },
  applied: { label: 'Applied', tone: 'ok' },
  parked: { label: 'Needs you', tone: 'warn' },
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

function RunCard({ run }: { run: AgentRun }) {
  const outcome = OUTCOME[run.outcome]
  const filled = run.answers.filter((a) => a.answer.length > 0)
  const written = run.answers.filter((a) => a.source === 'model' && a.kind === 'textarea').length

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
          {run.hasScreenshot && (
            <a className="button" href={`/api/agent/runs/${run.id}/screenshot`} target="_blank" rel="noreferrer">
              Screenshot
            </a>
          )}
          <a className="button" href={run.url} target="_blank" rel="noreferrer">
            Open form
          </a>
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

  const load = useCallback(async () => {
    const data = await api.agent()
    setProgress(data.progress)
    setRuns(data.runs)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!progress?.running) return
    const timer = setInterval(load, 2000)
    return () => clearInterval(timer)
  }, [progress?.running, load])

  const start = async () => {
    setProgress(await api.startDryRun(10))
    void load()
  }

  if (!progress) return null
  const ready = runs.filter((r) => r.outcome === 'ready').length
  const parked = runs.filter((r) => r.outcome === 'parked').length

  return (
    <>
      <h1>Activity</h1>
      <p className="lead">
        What the application agent did, job by job: every answer it gave, where each answer came from, and a screenshot of
        the filled form.
      </p>

      <section className="card find">
        <div>
          <strong>Dry run</strong>
          <span className="muted small">
            {progress.running
              ? `Filling ${progress.current ?? '…'} (${progress.done + 1} of ${progress.total}). A Chrome window shows it working.`
              : 'Fills 10 real application forms exactly as the agent would, then stops before submitting. Nothing is sent to employers.'}
          </span>
        </div>
        <button className="primary" onClick={start} disabled={progress.running}>
          {progress.running ? 'Running…' : runs.length ? 'Dry run 10 more' : 'Start dry run'}
        </button>
      </section>

      {runs.length > 0 && (
        <p className="muted small">
          {runs.length} runs · {ready} would submit as is · {parked} need you
        </p>
      )}
      {runs.map((run) => (
        <RunCard key={run.id} run={run} />
      ))}
      {runs.length === 0 && !progress.running && <p className="empty muted">No runs yet.</p>}
    </>
  )
}

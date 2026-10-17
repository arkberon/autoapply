import { useEffect, useState } from 'react'
import { PRIORITY_LABEL, type AgentProgress, type AgentRun, type Dashboard } from '../../shared/types.ts'
import { api } from '../api.ts'

// The view at the top of Activity while the agent is working: where the run is,
// the job being filled, what this run has done so far and what comes next.

const STEPS = ['Finding new jobs', 'Checking which postings are still open', 'Applying']

const TONE: Partial<Record<AgentRun['outcome'], { label: string; tone: string }>> = {
  applied: { label: 'Applied', tone: 'ok' },
  ready: { label: 'Ready', tone: 'info' },
  parked: { label: 'Needs you', tone: 'warn' },
  uncertain: { label: 'Check result', tone: 'warn' },
  closed: { label: 'Closed', tone: 'muted' },
  error: { label: 'Failed', tone: 'warn' },
}

export function LiveRun({ progress, runs, onStop }: { progress: AgentProgress; runs: AgentRun[]; onStop: () => void }) {
  const [dash, setDash] = useState<Dashboard | null>(null)

  useEffect(() => {
    const load = () => api.dashboard().then(setDash).catch(() => undefined)
    load()
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [])

  const schedule = dash?.schedule
  const scheduled = Boolean(schedule?.running)
  const live = progress.running && progress.mode === 'live'
  // The schedule's own step, or "Applying" once the agent has started.
  const stepIndex = progress.running ? 2 : Math.max(0, STEPS.indexOf(schedule?.step ?? ''))
  const thisRun = progress.startedAt ? runs.filter((r) => r.startedAt >= progress.startedAt! && r.outcome !== 'running' && r.outcome !== 'submitting') : []
  const count = (o: AgentRun['outcome']) => thisRun.filter((r) => r.outcome === o).length

  return (
    <>
      {scheduled && (
        <ol className="run-steps" aria-label="Run steps">
          {STEPS.map((step, i) => (
            <li key={step} className={i < stepIndex ? 'done' : i === stepIndex ? 'current' : ''}>
              <span className="run-step-mark" aria-hidden="true">
                {i < stepIndex ? '✓' : i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {progress.running && (
        <div className="live-grid">
          <section className="now-panel" aria-labelledby="now-h">
            <div className="card-head">
              <div className="list-text">
                <span className="kpi-label">
                  {live ? 'Now applying' : 'Dry run'} · {Math.min(progress.done + 1, progress.total)} of {progress.total}
                </span>
                <h2 id="now-h">{progress.current?.split(' · ')[0] ?? 'Starting…'}</h2>
                <span className="muted">{progress.current?.split(' · ').slice(1).join(' · ')}</span>
              </div>
              {live && (
                <button onClick={onStop} disabled={progress.stopping}>
                  {progress.stopping ? 'Stopping…' : 'Stop after this one'}
                </button>
              )}
            </div>
            <div className="band-progress" role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
              <div style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
            <p className="muted small">
              {live
                ? 'Submit is pressed once, only when every required answer is safe. The job is marked “submitting” first, so a crash can never send it twice. It pauses a minute or two between applications.'
                : 'Filling forms exactly as a live run would, then stopping before submit. Nothing is sent to employers.'}
            </p>
          </section>

          <section className="card done-panel" aria-labelledby="done-h">
            <h2 id="done-h">Done this run</h2>
            <div className="done-counts">
              <div className="chip-block ok">
                <strong>{live ? count('applied') : count('ready')}</strong>
                <span>{live ? 'Applied' : 'Ready'}</span>
              </div>
              <div className="chip-block warn">
                <strong>{count('parked')}</strong>
                <span>Need you</span>
              </div>
              <div className="chip-block muted">
                <strong>{count('uncertain') + count('error')}</strong>
                <span>To check</span>
              </div>
            </div>
            {thisRun.slice(0, 8).map((r) => (
              <div key={r.id} className="list-row">
                <div className="list-text">
                  <strong>{r.company}</strong>
                  <span className="muted small ellipsis">{r.reasons[0] ?? r.role}</span>
                </div>
                {TONE[r.outcome] && <span className={`chip-tone ${TONE[r.outcome]!.tone}`}>{TONE[r.outcome]!.label}</span>}
              </div>
            ))}
            {thisRun.length === 0 && <p className="muted small">Results appear here as each application finishes.</p>}
          </section>
        </div>
      )}

      {live && dash && dash.next.length > 0 && (
        <section className="card" aria-labelledby="next-h">
          <h2 id="next-h">Up next</h2>
          <div className="next-grid">
            {dash.next.map((n) => (
              <div key={n.id} className="next-item">
                <span className={`pill p${n.priority}`}>{PRIORITY_LABEL[n.priority]}</span>
                <strong>{n.company}</strong>
                <span className="muted small">{n.role}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

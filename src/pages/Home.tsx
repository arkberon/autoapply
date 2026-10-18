import { useCallback, useEffect, useState } from 'react'
import { PRIORITY_LABEL, type AgentRun, type Dashboard, type Priority, type Summary } from '../../shared/types.ts'
import { api, timeAgo } from '../api.ts'
import type { Tab } from '../App.tsx'
import { ShareCard } from './ShareCard.tsx'
import { OpenFormButton } from './OpenForm.tsx'

interface Props {
  summary: Summary
  go: (tab: Tab) => void
  refresh: () => void
}

const PRIORITY_COLOR: Record<Priority, string> = { 1: 'var(--p1)', 2: 'var(--p2)', 3: 'var(--p3)', 4: 'var(--p4)' }

const OUTCOME: Record<AgentRun['outcome'], { label: string; tone: string }> = {
  running: { label: 'Working', tone: 'info' },
  submitting: { label: 'Submitting', tone: 'info' },
  ready: { label: 'Ready', tone: 'info' },
  applied: { label: 'Applied', tone: 'ok' },
  parked: { label: 'Needs you', tone: 'warn' },
  uncertain: { label: 'Check result', tone: 'warn' },
  closed: { label: 'Closed', tone: 'muted' },
  error: { label: 'Failed', tone: 'warn' },
}

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `today at ${time}`
  return `${d.toLocaleDateString([], { weekday: 'long' })} at ${time}`
}

function Ring({ value, max }: { value: number; max: number }) {
  const r = 84
  const c = 2 * Math.PI * r
  const shown = Math.min(1, value / Math.max(max, 1)) * c
  return (
    <figure className="ring">
      <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={`${value} of ${max} applications sent today`}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="#2A2D33" strokeWidth="16" />
        {value > 0 && (
          <circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${shown} ${c}`}
            transform="rotate(-90 100 100)"
          />
        )}
      </svg>
      <figcaption>
        <span className="ring-number">
          {value}
          <span>/{max}</span>
        </span>
        <span className="ring-label">applied today</span>
      </figcaption>
    </figure>
  )
}

function Bar({ value, max, color = 'var(--text)' }: { value: number; max: number; color?: string }) {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(2, (value / Math.max(max, 1)) * 100)}%`, background: color }} />
    </div>
  )
}

export function Home({ summary, go, refresh }: Props) {
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [busy, setBusy] = useState('')
  const [sharing, setSharing] = useState(false)

  const load = useCallback(() => {
    api.dashboard().then(setDash).catch(() => undefined)
  }, [])

  // Faster updates while something is running.
  // The model is tested in the background when the app starts; until then its status is unknown, not broken.
  const llmPending = summary.llm.message === 'Not tested yet.'
  const active = Boolean(dash?.agent.running || dash?.schedule.running || summary.verify.running || summary.discover.running || llmPending)
  useEffect(() => {
    load()
    const timer = setInterval(() => {
      load()
      if (active) refresh()
    }, active ? 3000 : 30_000)
    return () => clearInterval(timer)
  }, [load, refresh, active])

  if (!dash) return null

  const { setup, resume, llm, byLive, byStatus, byPriority, byArea, discover } = summary
  const { today, agent, schedule } = dash
  const applied = byStatus.applied ?? 0
  const toApply = summary.jobs - applied
  const setupDone = setup.answered === setup.required
  const resumeOk = Boolean(resume.pdf) && !resume.error
  const live = agent.running && agent.mode === 'live'
  const ready = setupDone && resumeOk && (llm.ok || llmPending)

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name)
    await fn().catch(() => undefined)
    setBusy('')
    refresh()
    load()
  }

  const startApplying = () => {
    const n = Math.min(today.cap - today.applied, today.ready)
    if (!window.confirm(`The agent will submit real applications to up to ${n} employers now, using your saved answers and resume. Jobs it can't answer safely are left for you. Continue?`)) return
    void act('live', () => api.startLive())
  }

  const toggleSchedule = () => {
    if (schedule.enabled) return void act('schedule', () => api.saveSchedule({ enabled: false }))
    if (!window.confirm(`Every ${schedule.weekdaysOnly ? 'weekday' : 'day'} at ${schedule.time} the app will apply for real to up to ${today.cap} jobs, without asking first. Turn the daily schedule on?`)) return
    void act('schedule', () => api.saveSchedule({ enabled: true }))
  }

  // ── Status band copy
  let chip = { label: 'Idle', dot: 'ok' }
  let headline = `${today.ready} jobs ready for the agent.`
  let sub = 'Press Start applying, or turn on the daily schedule and let it run by itself.'
  if (!ready) {
    chip = { label: 'Setup needed', dot: 'warn' }
    headline = 'Finish setup to start applying.'
    sub = 'A few things below need attention before the agent can apply for you.'
  } else if (live) {
    chip = { label: 'Applying now', dot: 'busy' }
    headline = `Applying now. ${today.applied} of ${today.cap} done.`
    sub = agent.stopping ? `Finishing ${agent.current ?? 'the current application'}, then stopping.` : `Filling ${agent.current ?? 'the next application'}.`
  } else if (schedule.running) {
    chip = { label: 'Daily run', dot: 'busy' }
    headline = `${schedule.step ?? 'Starting'}…`
    sub = 'Your daily run is underway. It applies once the search and checks finish.'
  } else if (agent.running) {
    chip = { label: 'Dry run', dot: 'busy' }
    headline = 'Dry run in progress.'
    sub = `Filling ${agent.current ?? 'a form'} without submitting anything.`
  } else if (schedule.enabled) {
    chip = { label: 'On autopilot', dot: 'ok' }
    headline = `On autopilot. Next run ${when(schedule.nextRun)}.`
    sub = `${today.ready} jobs are ready. It finds new openings, re-checks postings, then applies up to your daily limit and sends you a summary.`
  }

  const areas = Object.entries(byArea)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const areaMax = areas[0]?.[1] ?? 1
  const priorities = ([1, 2, 3, 4] as Priority[]).map((p) => ({ p, n: byPriority[p] ?? 0 }))
  const pipeline = [
    { label: 'Found by the agent', value: discover.found, note: `On ${discover.boards} company job boards`, color: 'var(--p4)' },
    { label: 'On your list', value: toApply, note: 'Ranked by priority', color: 'var(--text)' },
    { label: 'Ready to auto-apply', value: today.ready, note: 'Every answer is safe', color: 'var(--p2)' },
    { label: 'Applied', value: applied, note: 'Confirmed or marked by you', color: 'var(--ok)' },
  ]
  const pipeMax = Math.max(...pipeline.map((p) => p.value), 1)

  const health = [
    {
      ok: resumeOk,
      label: resumeOk ? 'Resume synced' : 'Resume not synced',
      note: resume.error ?? (resume.syncedAt ? `From your Google Doc, ${timeAgo(resume.syncedAt)}` : 'Link your Google Doc in Settings'),
      action: resumeOk ? null : { label: busy === 'resume' ? 'Syncing…' : 'Sync now', run: () => act('resume', () => api.syncResume()) },
    },
    {
      ok: llm.ok || llmPending,
      label: llmPending ? 'Checking local model…' : llm.ok ? 'Local model connected' : 'Local model not connected',
      note: llmPending ? 'Testing the connection' : llm.ok ? 'Nothing leaves your Mac' : llm.message,
      action: llm.ok || llmPending ? null : { label: busy === 'llm' ? 'Testing…' : 'Test again', run: () => act('llm', () => api.testLlm()) },
    },
    {
      ok: setupDone,
      label: setupDone ? 'Setup complete' : 'Setup questions',
      note: `${setup.answered} of ${setup.required} needed answers saved`,
      action: setupDone ? null : { label: 'Answer', run: () => go('setup') },
    },
    {
      ok: Boolean(summary.lastChecked) && !summary.verify.running,
      label: summary.verify.running ? 'Checking postings…' : 'Postings checked',
      note: summary.verify.running
        ? `${summary.verify.done} of ${summary.verify.total}`
        : summary.lastChecked
          ? `${byLive.open ?? 0} open, last checked ${timeAgo(summary.lastChecked)}`
          : 'Not checked yet',
      action: summary.verify.running ? null : { label: 'Check now', run: () => act('verify', () => api.startVerify()) },
    },
  ]

  return (
    <>
      <section className="status-band" aria-label="Agent status">
        <div className="status-copy">
          <div className="status-meta">
            <span className="status-chip">
              <span className={`dot ${chip.dot}`} aria-hidden="true" />
              {chip.label}
            </span>
            <span className="muted small">
              {schedule.enabled ? `Daily schedule · every ${schedule.weekdaysOnly ? 'weekday' : 'day'} at ${schedule.time}` : 'Daily schedule off'}
            </span>
          </div>
          <h1>{headline}</h1>
          <p>{sub}</p>
          {live && (
            <div className="band-progress" role="progressbar" aria-label="Today's progress" aria-valuemin={0} aria-valuemax={today.cap} aria-valuenow={today.applied}>
              <div style={{ width: `${(today.applied / Math.max(today.cap, 1)) * 100}%` }} />
            </div>
          )}
          <div className="band-actions">
            {live || schedule.running ? (
              <button className="primary" onClick={() => go('activity')}>
                Watch the run
              </button>
            ) : (
              <button className="primary" onClick={startApplying} disabled={!ready || agent.running || today.ready === 0 || today.applied >= today.cap || busy !== ''}>
                {today.applied >= today.cap ? 'Limit reached today' : 'Start applying'}
              </button>
            )}
            <button className="ghost" onClick={() => act('dry', () => api.startDryRun(10))} disabled={agent.running || busy !== ''}>
              Dry run 10
            </button>
            <button className="ghost" onClick={toggleSchedule} disabled={busy !== ''}>
              {schedule.enabled ? 'Pause schedule' : 'Turn on schedule'}
            </button>
            <button className="ghost" onClick={() => setSharing(true)}>
              Share
            </button>
          </div>
        </div>
        <Ring value={today.applied} max={today.cap} />
      </section>

      <section className="kpis" aria-label="Totals">
        <article className="kpi">
          <span className="kpi-label">Applied</span>
          <span className="kpi-value" style={{ color: 'var(--ok)' }}>{applied}</span>
          <span className="muted small">Confirmed or marked by you</span>
        </article>
        <article className="kpi">
          <span className="kpi-label">To apply</span>
          <span className="kpi-value">{toApply}</span>
          <span className="muted small">On your list right now</span>
        </article>
        <article className="kpi">
          <span className="kpi-label">Ready for the agent</span>
          <span className="kpi-value" style={{ color: 'var(--p2)' }}>{today.ready}</span>
          <span className="muted small">Priorities 1–3 it can finish alone</span>
        </article>
        <article className="kpi">
          <span className="kpi-label">Found by the agent</span>
          <span className="kpi-value">{discover.found}</span>
          <span className="muted small">New openings, no spreadsheet</span>
        </article>
      </section>

      <section className="card" aria-labelledby="pipe-h">
        <div className="card-head">
          <h2 id="pipe-h">Your pipeline</h2>
          <button className="link-button" onClick={() => go('jobs')}>
            Open jobs
          </button>
        </div>
        <div className="pipeline">
          {pipeline.map((p) => (
            <div key={p.label} className="pipe">
              <div className="pipe-top">
                <span>{p.label}</span>
                <span className="mono">{p.value}</span>
              </div>
              <Bar value={p.value} max={pipeMax} color={p.color} />
              <span className="muted small">{p.note}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="area-h">
          <h2 id="area-h">By work area</h2>
          <div className="area-rows">
            {areas.map(([area, n]) => (
              <div key={area} className="area-row">
                <span>{area}</span>
                <Bar value={n} max={areaMax} />
                <span className="mono">{n}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card" aria-labelledby="prio-h">
          <h2 id="prio-h">Priority mix</h2>
          <div className="stack-bar" role="img" aria-label={priorities.map(({ p, n }) => `${PRIORITY_LABEL[p]} ${n}`).join(', ')}>
            {priorities.map(({ p, n }) => (
              <div key={p} style={{ flex: `${n} 1 0`, background: PRIORITY_COLOR[p] }} />
            ))}
          </div>
          <ul className="legend">
            {priorities.map(({ p, n }) => (
              <li key={p}>
                <span aria-hidden="true" style={{ background: PRIORITY_COLOR[p] }} />
                <span>{PRIORITY_LABEL[p]}</span>
                <span className="mono">{n}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Ranked from how well your resume fits and how hard the role is to land. Nothing is skipped; long shots go last.</p>
        </section>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="needs-h">
          <div className="card-head">
            <h2 id="needs-h">Needs you</h2>
            {dash.needsYou.length > 0 && <span className="chip-tone warn">{dash.needsYou.length} waiting</span>}
          </div>
          {dash.needsYou.length === 0 && <p className="muted">Nothing is waiting for you. Jobs the agent can't finish safely show up here with the reason.</p>}
          {dash.needsYou.slice(0, 6).map((n) => (
            <div key={n.jobId} className="list-row">
              <div className="list-text">
                <strong>{n.company}</strong>
                <span className="muted small">{n.reason}</span>
              </div>
              <OpenFormButton jobId={n.jobId} url={n.url} />
              {n.status !== 'uncertain' && (
                <button onClick={() => act(`retry-${n.jobId}`, () => api.patchJob(n.jobId, { status: 'not_started' }))}>Try again</button>
              )}
            </div>
          ))}
        </section>

        <section className="card" aria-labelledby="feed-h">
          <div className="card-head">
            <h2 id="feed-h">Recent agent runs</h2>
            <button className="link-button" onClick={() => go('activity')}>
              See all
            </button>
          </div>
          {dash.recent.length === 0 && <p className="muted">No runs yet. Try a dry run to see the agent fill forms without sending anything.</p>}
          {dash.recent.map((r) => (
            <div key={r.id} className="list-row">
              <span className="initial" aria-hidden="true">
                {r.company.slice(0, 1)}
              </span>
              <div className="list-text">
                <strong>{r.company}</strong>
                <span className="muted small ellipsis">
                  {r.role} · {r.mode === 'dry' ? 'dry run' : 'live'} {timeAgo(r.startedAt)}
                </span>
              </div>
              <span className={`chip-tone ${OUTCOME[r.outcome].tone}`}>{OUTCOME[r.outcome].label}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="health" aria-label="Setup health">
        {health.map((h) => (
          <div key={h.label} className={h.ok ? 'health-item' : 'health-item todo'}>
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="11" r="10" fill={h.ok ? 'var(--ok-bg)' : 'var(--warn-bg)'} />
              {h.ok ? (
                <path d="M6.5 11.5l3 3 6-7" fill="none" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M11 6v6M11 15.5v.5" fill="none" stroke="var(--warn)" strokeWidth="2" strokeLinecap="round" />
              )}
            </svg>
            <div className="list-text">
              <strong className="small">{h.label}</strong>
              <span className="muted small">{h.note}</span>
            </div>
            {h.action && <button onClick={h.action.run}>{h.action.label}</button>}
          </div>
        ))}
      </section>

      {sharing && <ShareCard applied={applied} ranked={toApply} found={discover.found} onClose={() => setSharing(false)} />}
    </>
  )
}

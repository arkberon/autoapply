import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  MODE_HELP,
  MODE_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type Job,
  type Mode,
  type Priority,
} from '../../shared/types.ts'
import { api, timeAgo, type JobDetail } from '../api.ts'

const PRIORITIES: Priority[] = [1, 2, 3, 4]
const MODES: Mode[] = ['auto', 'review', 'assist', 'manual', 'email']
const LIVE_LABEL = { open: 'Open', closed: 'Closed', unknown: 'Not checked' } as const

function salary(job: Job): string {
  const k = (n: number) => `$${Math.round(n / 1000)}k`
  if (job.salary_low && job.salary_high) return `${k(job.salary_low)}–${k(job.salary_high)}`
  if (job.salary_low) return `from ${k(job.salary_low)}`
  return 'Not listed'
}

function Detail({ job, onChange }: { job: Job; onChange: (job: Job) => void }) {
  const [detail, setDetail] = useState<JobDetail | null>(null)

  useEffect(() => {
    api.job(job.id).then(setDetail)
  }, [job.id])

  const setStatus = async (status: 'applied' | 'not_started') => onChange(await api.patchJob(job.id, { status }))

  return (
    <div className="detail">
      <dl>
        <dt>Why this priority</dt>
        <dd>{job.priority_reason}</dd>
        <dt>Resume fit</dt>
        <dd>{job.fit || 'Not rated'}</dd>
        <dt>Difficulty</dt>
        <dd>{job.difficulty || 'Not estimated'}</dd>
        <dt>Location</dt>
        <dd>{job.location || job.market}</dd>
        <dt>Salary</dt>
        <dd>{salary(job)}</dd>
        <dt>How it applies</dt>
        <dd>
          {MODE_LABEL[job.mode]} via {job.ats}. {MODE_HELP[job.mode]}
        </dd>
        <dt>Posting</dt>
        <dd>
          {job.live_note || 'Not checked yet.'}
          {job.live_checked_at && <span className="muted"> Checked {timeAgo(job.live_checked_at)}.</span>}
        </dd>
        {job.notes && (
          <>
            <dt>Notes</dt>
            <dd>{job.notes}</dd>
          </>
        )}
      </dl>

      {job.dup_of && (
        <p className="banner warn">
          This is the same posting as another row on your list. The app will apply to it once, not twice.
        </p>
      )}

      {detail && detail.drafts.length > 0 && (
        <details>
          <summary>{detail.drafts.length} written answers already drafted for this job</summary>
          {detail.drafts.map((d) => (
            <div key={d.label} className="draft">
              <strong>{d.label}</strong>
              <p>{d.value}</p>
            </div>
          ))}
        </details>
      )}

      <div className="detail-actions">
        <a className="button" href={job.url} target="_blank" rel="noreferrer">
          {job.mode === 'email' ? 'Open email' : 'Open posting'}
        </a>
        {job.status === 'applied' ? (
          <button onClick={() => setStatus('not_started')}>Undo "applied"</button>
        ) : (
          <button onClick={() => setStatus('applied')}>I applied to this myself</button>
        )}
      </div>
    </div>
  )
}

export function Jobs({ verifying }: { verifying: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [priority, setPriority] = useState<Priority | 0>(0)
  const [mode, setMode] = useState<Mode | ''>('')
  const [search, setSearch] = useState('')
  const [hideDone, setHideDone] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(() => {
    api.jobs().then(setJobs)
  }, [])

  useEffect(load, [load])
  useEffect(() => {
    if (!verifying) return load()
    const timer = setInterval(load, 2500)
    return () => clearInterval(timer)
  }, [verifying, load])

  const replace = (next: Job) => setJobs((all) => all.map((j) => (j.id === next.id ? next : j)))

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    return jobs.filter(
      (j) =>
        (!priority || j.priority === priority) &&
        (!mode || j.mode === mode) &&
        (!hideDone || (j.live !== 'closed' && j.status !== 'applied')) &&
        (!term || `${j.company} ${j.role} ${j.market} ${j.ats}`.toLowerCase().includes(term)),
    )
  }, [jobs, priority, mode, search, hideDone])

  const count = (p: Priority) => jobs.filter((j) => j.priority === p).length

  return (
    <>
      <h1>Jobs</h1>
      <p className="lead">
        Every job on your list, in the order the app will work through them. Click a row for details, or change its
        priority on the left.
      </p>

      <div className="toolbar">
        <div className="chips">
          <button className={priority === 0 ? 'chip active' : 'chip'} onClick={() => setPriority(0)}>
            All {jobs.length}
          </button>
          {PRIORITIES.map((p) => (
            <button key={p} className={priority === p ? 'chip active' : 'chip'} onClick={() => setPriority(p)}>
              {PRIORITY_LABEL[p]} {count(p)}
            </button>
          ))}
        </div>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode | '')} aria-label="How it applies">
          <option value="">Any method</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Search company or role" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Hide closed and applied
        </label>
      </div>

      <p className="muted small">
        Showing {shown.length} of {jobs.length}
      </p>

      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Job</th>
              <th>How it applies</th>
              <th>Posting</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((job) => (
              <Fragment key={job.id}>
                <tr
                  className={[openId === job.id ? 'open' : '', job.live === 'closed' ? 'dim' : ''].join(' ')}
                  onClick={() => setOpenId(openId === job.id ? null : job.id)}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      className={`pill-select p${job.priority}`}
                      value={job.priority}
                      aria-label={`Priority for ${job.company}`}
                      onChange={async (e) => replace(await api.patchJob(job.id, { priority: Number(e.target.value) as Priority }))}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p} · {PRIORITY_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <strong>{job.company}</strong>
                    <span className="role">{job.role}</span>
                    <span className="muted small">{job.market}</span>
                  </td>
                  <td>
                    {MODE_LABEL[job.mode]}
                    <span className="muted small">{job.ats}</span>
                  </td>
                  <td>
                    <span className={`live ${job.live}`}>{LIVE_LABEL[job.live]}</span>
                  </td>
                  <td>
                    <span className={`status ${job.status}`}>{STATUS_LABEL[job.status]}</span>
                    {job.dup_of && <span className="muted small">Duplicate row</span>}
                  </td>
                </tr>
                {openId === job.id && (
                  <tr className="detail-row">
                    <td colSpan={5}>
                      <Detail job={job} onChange={replace} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty muted">No jobs match these filters.</p>}
      </div>
    </>
  )
}

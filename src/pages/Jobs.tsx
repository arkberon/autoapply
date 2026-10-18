import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  MODE_HELP,
  MODE_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type Job,
  type Mode,
  type Priority,
  type Summary,
  type WorkArea,
  WORK_AREAS,
} from '../../shared/types.ts'
import { isRemote, placeLabel, placesOf, REGION_STATE, REGIONS, regionsOf, US_STATES } from '../../shared/regions.ts'
import { api, isStale, postedAgo, timeAgo, type JobDetail } from '../api.ts'
import { Cleanup } from './Cleanup.tsx'
import { OpenFormButton } from './OpenForm.tsx'

const PRIORITIES: Priority[] = [1, 2, 3, 4]
const MODES: Mode[] = ['auto', 'review', 'assist', 'manual', 'email']
const LIVE_LABEL = { open: 'Open', closed: 'Closed', unknown: 'Not checked' } as const

type View = 'todo' | 'applied' | 'removed'

function appliedOn(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'date not recorded'
}

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

  const setRemoved = async (removed: boolean) => {
    if (removed && !window.confirm(`Remove ${job.company} – ${job.role} from your list? You can bring it back with "Show removed".`)) return
    onChange(await api.patchJob(job.id, { removed }))
  }

  return (
    <div className="detail">
      <dl>
        <dt>Why this priority</dt>
        <dd>{job.priority_reason}</dd>
        <dt>Work area</dt>
        <dd>
          <select
            className="area-select"
            value={job.area ?? 'Other'}
            aria-label="Work area"
            onChange={async (e) => onChange(await api.patchJob(job.id, { area: e.target.value as WorkArea }))}
          >
            {WORK_AREAS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <span className="muted small">
            {job.area_source === 'you' ? ' Set by you' : job.area_source === 'model' ? ' Sorted by your local model' : ' Sorted from the job title'}
          </span>
        </dd>
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
        <dt>Posted</dt>
        <dd>
          {job.posted_at
            ? `${new Date(job.posted_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} (${postedAgo(job.posted_at)})`
            : 'Unknown. The employer did not publish a date, or it has not been checked yet.'}
          {isStale(job.posted_at) && <span className="muted"> Older than two months; it may be filled already.</span>}
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
        {job.mode !== 'email' && job.status !== 'applied' && <OpenFormButton jobId={job.id} url={job.url} label="Fill form for me" />}
        {job.status === 'applied' ? (
          <button onClick={() => setStatus('not_started')}>Undo "applied"</button>
        ) : (
          <button onClick={() => setStatus('applied')}>I applied to this myself</button>
        )}
        {job.removed ? (
          <button onClick={() => setRemoved(false)}>Put back on my list</button>
        ) : (
          <button className="danger" onClick={() => setRemoved(true)}>
            Remove from my list
          </button>
        )}
      </div>
    </div>
  )
}

const REMOTE_KEY = 'remote'
const UNKNOWN_KEY = 'unknown'
const SPECIAL_STATES: Record<string, string> = { [REMOTE_KEY]: 'Remote (US)', [UNKNOWN_KEY]: 'Location not stated' }

/** "California (359)", most jobs first, with remote roles as their own option. */
function stateOptions(list: Job[], where: Map<string, { states: Set<string> }>) {
  const counts = new Map<string, number>()
  for (const j of list) for (const s of where.get(j.id)!.states) counts.set(s, (counts.get(s) ?? 0) + 1)
  return [...counts]
    .map(([key, n]) => ({ key, n, label: SPECIAL_STATES[key] ?? US_STATES[key] }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
}

export function Jobs({ summary, busy, refresh }: { summary: Summary; busy: boolean; refresh: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [priority, setPriority] = useState<Priority | 0>(0)
  const [mode, setMode] = useState<Mode | ''>('')
  const [area, setArea] = useState<WorkArea | ''>('')
  // City is "area:<market>" for a searched region (SF Bay Area) or "city:Austin, TX".
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('todo')
  const [hideClosed, setHideClosed] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [note, setNote] = useState('')
  const [onlyFound, setOnlyFound] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(() => {
    api.jobs().then(setJobs)
  }, [])

  useEffect(load, [load])
  useEffect(() => {
    if (!busy) return load()
    const timer = setInterval(load, 2500)
    return () => clearInterval(timer)
  }, [busy, load])

  const findJobs = async () => {
    await api.startDiscover()
    refresh()
  }

  const replace = (next: Job) => setJobs((all) => all.map((j) => (j.id === next.id ? next : j)))

  // Where each job is, worked out once per load: its states, cities and searched regions.
  const where = useMemo(() => {
    const map = new Map<string, { states: Set<string>; cities: Set<string>; regions: string[]; label: string }>()
    for (const j of jobs) {
      const places = placesOf(j.market, j.location)
      const states = new Set(places.map((p) => p.state))
      if (isRemote(j.market, j.location)) states.add(REMOTE_KEY)
      if (!states.size) states.add(UNKNOWN_KEY)
      map.set(j.id, {
        states,
        cities: new Set(places.filter((p) => p.city).map(placeLabel)),
        regions: regionsOf(j.market, j.location),
        // Jobs outside the searched regions show their own city: "Austin, TX +2".
        label:
          j.market === 'Other US' && places.length
            ? `${placeLabel(places[0])}${places.length > 1 ? ` +${places.length - 1}` : ''}`
            : j.market,
      })
    }
    return map
  }, [jobs])

  const inState = (j: Job) => !state || where.get(j.id)!.states.has(state)
  const inCity = (j: Job, c = city) =>
    !c || (c.startsWith('area:') ? where.get(j.id)!.regions.includes(c.slice(5)) : where.get(j.id)!.cities.has(c.slice(5)))

  const inView = (j: Job, v: View) =>
    v === 'removed' ? j.removed === 1 : j.removed === 0 && (v === 'applied') === (j.status === 'applied')

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = jobs.filter(
      (j) =>
        inView(j, view) &&
        (!onlyFound || j.discovered_at !== null) &&
        (!priority || j.priority === priority) &&
        (!mode || j.mode === mode) &&
        (!area || (j.area ?? 'Other') === area) &&
        inState(j) &&
        inCity(j) &&
        (!hideClosed || j.live !== 'closed') &&
        (!term || `${j.company} ${j.role} ${where.get(j.id)!.label} ${j.ats}`.toLowerCase().includes(term)),
    )
    // Most recent applications first.
    return view === 'applied' ? list.sort((a, b) => (b.applied_at ?? '').localeCompare(a.applied_at ?? '')) : list
  }, [jobs, view, priority, mode, area, city, state, where, search, hideClosed, onlyFound])

  const viewCount = (v: View) => jobs.filter((j) => inView(j, v)).length
  const current = jobs.filter((j) => inView(j, view))
  const foundCount = current.filter((j) => j.discovered_at).length
  const { discover } = summary
  const count = (p: Priority) => current.filter((j) => j.priority === p).length

  const cleaned = (removed: number) => {
    setCleaning(false)
    setNote(`Removed ${removed} job${removed === 1 ? '' : 's'}. Open "Removed" to bring any back.`)
    load()
    refresh()
  }

  return (
    <>
      <h1>Jobs</h1>
      <p className="lead">
        Every job on your list, in the order the app will work through them. Click a row for details, or change its
        priority on the left.
      </p>

      <div className="card find">
        <div>
          <strong>Find new jobs</strong>
          <span className="muted small">
            {discover.running
              ? `Searching ${discover.done} of ${discover.total} sources… ${discover.added} new so far.`
              : discover.finishedAt
                ? `Last search ${timeAgo(discover.finishedAt)} added ${discover.lastAdded} new job${discover.lastAdded === 1 ? '' : 's'}.`
                : `Searches ${discover.boards} company job boards and a public list of new-grad openings, then adds the ones that match your filters in Settings.`}
          </span>
          {!discover.running && discover.report && (
            <span className="muted small search-report">
              {[discover.report.lists, discover.report.boards]
                .filter((r) => r.sources > 0)
                .map((r, i) => {
                  const name = r === discover.report!.lists ? 'Public new-grad list' : `${r.sources} company boards`
                  return (
                    <span key={i}>
                      <strong>{name}:</strong> {r.checked.toLocaleString()} postings checked · <strong>{r.added} new</strong> ·{' '}
                      {r.known} already on your list · {r.otherPlaces} {discover.report!.allUs ? 'outside the US' : 'outside your cities'} · {r.otherTitles} other kinds of roles ·{' '}
                      {r.tooOld} too old
                    </span>
                  )
                })}
            </span>
          )}
        </div>
        <button className="primary" onClick={findJobs} disabled={discover.running}>
          {discover.running ? 'Searching…' : 'Find new jobs'}
        </button>
      </div>

      <div className="views" role="tablist">
        {(
          [
            ['todo', 'To apply'],
            ['applied', 'Applied'],
            ['removed', 'Removed'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={view === v ? 'view active' : 'view'}
            onClick={() => {
              setView(v)
              setOpenId(null)
            }}
          >
            {label} <span className="muted">{viewCount(v)}</span>
          </button>
        ))}
        <span className="views-spacer" />
        {view === 'todo' && (
          <button className="cleanup-toggle" onClick={() => setCleaning(!cleaning)}>
            {cleaning ? 'Close clean up' : 'Clean up…'}
          </button>
        )}
      </div>

      {note && <p className="banner ok">{note}</p>}
      {cleaning && view === 'todo' && <Cleanup jobs={jobs} onDone={cleaned} />}

      <div className="toolbar">
        <div className="chips">
          <button className={priority === 0 ? 'chip active' : 'chip'} onClick={() => setPriority(0)}>
            All {current.length}
          </button>
          {PRIORITIES.map((p) => (
            <button key={p} className={priority === p ? 'chip active' : 'chip'} onClick={() => setPriority(p)}>
              {PRIORITY_LABEL[p]} {count(p)}
            </button>
          ))}
          {foundCount > 0 && (
            <button className={onlyFound ? 'chip active' : 'chip'} onClick={() => setOnlyFound(!onlyFound)}>
              Found by the app {foundCount}
            </button>
          )}
        </div>
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value)
            setCity('')
          }}
          aria-label="State"
        >
          <option value="">Every state</option>
          {stateOptions(current, where).map((o) => (
            <option key={o.key} value={o.key}>
              {o.label} ({o.n})
            </option>
          ))}
        </select>
        <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
          <option value="">{state ? `Every city in ${SPECIAL_STATES[state] ?? US_STATES[state]}` : 'Every city'}</option>
          {(() => {
            const inScope = current.filter(inState)
            const areas = REGIONS.filter((r) => !state || REGION_STATE[r.market] === state)
              .map((r) => ({ key: `area:${r.market}`, label: r.label, n: inScope.filter((j) => inCity(j, `area:${r.market}`)).length }))
              .filter((o) => o.n > 0)
            const counts = new Map<string, number>()
            for (const j of inScope) for (const c of where.get(j.id)!.cities) if (!state || c.endsWith(`, ${state}`)) counts.set(c, (counts.get(c) ?? 0) + 1)
            const cities = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            return (
              <>
                {areas.length > 0 && (
                  <optgroup label="Areas">
                    {areas.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label} ({o.n})
                      </option>
                    ))}
                  </optgroup>
                )}
                {cities.length > 0 && (
                  <optgroup label="Cities">
                    {cities.map(([c, n]) => (
                      <option key={c} value={`city:${c}`}>
                        {c} ({n})
                      </option>
                    ))}
                  </optgroup>
                )}
              </>
            )
          })()}
        </select>
        <select value={area} onChange={(e) => setArea(e.target.value as WorkArea | '')} aria-label="Work area">
          <option value="">Every work area</option>
          {WORK_AREAS.filter((a) => current.some((j) => (j.area ?? 'Other') === a)).map((a) => (
            <option key={a} value={a}>
              {a} ({current.filter((j) => (j.area ?? 'Other') === a).length})
            </option>
          ))}
        </select>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode | '')} aria-label="How it applies">
          <option value="">Any method</option>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Search company or role" value={search} onChange={(e) => setSearch(e.target.value)} />
        {view === 'todo' && (
          <label className="check">
            <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} />
            Hide closed postings
          </label>
        )}
      </div>

      <p className="muted small">
        Showing {shown.length} of {current.length}
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
                    {job.discovered_at && <span className="tag ok">New {timeAgo(job.discovered_at)}</span>}
                    <span className="role">{job.role}</span>
                    <span className="muted small">
                      {where.get(job.id)?.label ?? job.market}
                      {job.area && <span className="area-tag">{job.area}</span>}
                      <span className={isStale(job.posted_at) ? 'posted stale' : 'posted'}>
                        {job.posted_at ? `Posted ${postedAgo(job.posted_at)}` : 'Posting date unknown'}
                      </span>
                    </span>
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
                    {job.status === 'applied' && <span className="muted small">{appliedOn(job.applied_at)}</span>}
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
        {shown.length === 0 && (
          <p className="empty muted">
            {view === 'applied' && current.length === 0
              ? 'Nothing applied yet. Mark a job with "I applied to this myself" and it moves here.'
              : view === 'removed' && current.length === 0
                ? 'No removed jobs.'
                : 'No jobs match these filters.'}
          </p>
        )}
      </div>
    </>
  )
}

import { useMemo, useState } from 'react'
import type { Job } from '../../shared/types.ts'
import { api } from '../api.ts'

const SAVED_KEY = 'autoapply.cleanup'

interface Options {
  keywords: string
  matchCompany: boolean
  closed: boolean
}

function loadOptions(): Options {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as Options | null
    if (saved) return saved
  } catch {
    // Storage can be unavailable; start blank.
  }
  return { keywords: '', matchCompany: false, closed: false }
}

function saveOptions(options: Options) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(options))
  } catch {
    // Remembering the keywords is a convenience only.
  }
}

/** Whole-word, case-insensitive match against any of the comma-separated keywords. */
function keywordPattern(list: string): RegExp | null {
  const terms = list
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return terms.length ? new RegExp(`(^|[^a-z0-9])(${terms.join('|')})($|[^a-z0-9])`, 'i') : null
}

export function Cleanup({ jobs, onDone }: { jobs: Job[]; onDone: (removed: number) => void }) {
  const [options, setOptions] = useState<Options>(loadOptions)
  const [busy, setBusy] = useState(false)

  const set = (patch: Partial<Options>) => {
    const next = { ...options, ...patch }
    setOptions(next)
    saveOptions(next)
  }

  // Only jobs still waiting to be applied to are ever candidates.
  const matches = useMemo(() => {
    const pattern = keywordPattern(options.keywords)
    return jobs.filter((j) => {
      if (j.removed || j.status === 'applied') return false
      const byWord = pattern && (pattern.test(j.role) || (options.matchCompany && pattern.test(j.company)))
      return byWord || (options.closed && j.live === 'closed')
    })
  }, [jobs, options])

  const remove = async () => {
    if (!window.confirm(`Remove ${matches.length} jobs from your list? You can restore any of them from "Removed".`)) return
    setBusy(true)
    const { removed } = await api.removeJobs(matches.map((j) => j.id))
    setBusy(false)
    onDone(removed)
  }

  return (
    <section className="card cleanup">
      <h2>Clean up your list</h2>
      <p className="muted small section-note">
        Removes jobs you have not applied to yet. Applied jobs are never touched, and anything removed can be restored
        from the Removed view.
      </p>

      <label htmlFor="cleanup-words">Remove jobs whose title contains any of</label>
      <textarea
        id="cleanup-words"
        rows={2}
        value={options.keywords}
        placeholder="e.g. sales, recruiter, nurse, mechanical, sap, salesforce"
        onChange={(e) => set({ keywords: e.target.value })}
      />
      <p className="help">Separate words with commas. Whole words only, so "sales" will not match "salesforce".</p>

      <div className="cleanup-options">
        <label className="check">
          <input type="checkbox" checked={options.matchCompany} onChange={(e) => set({ matchCompany: e.target.checked })} />
          Also match company names
        </label>
        <label className="check">
          <input type="checkbox" checked={options.closed} onChange={(e) => set({ closed: e.target.checked })} />
          Also remove postings that have closed
        </label>
      </div>

      {matches.length > 0 ? (
        <>
          <p className="small">
            <strong>{matches.length}</strong> job{matches.length === 1 ? '' : 's'} will be removed:
          </p>
          <ul className="cleanup-list">
            {matches.slice(0, 60).map((j) => (
              <li key={j.id}>
                <strong>{j.company}</strong> · {j.role}
                {j.live === 'closed' && <span className="muted"> (closed)</span>}
              </li>
            ))}
            {matches.length > 60 && <li className="muted">…and {matches.length - 60} more</li>}
          </ul>
          <button className="danger" onClick={remove} disabled={busy}>
            {busy ? 'Removing…' : `Remove ${matches.length} job${matches.length === 1 ? '' : 's'}`}
          </button>
        </>
      ) : (
        <p className="muted small">
          {options.keywords.trim() || options.closed ? 'Nothing matches yet.' : 'Type a few words to see what would be removed.'}
        </p>
      )}
    </section>
  )
}

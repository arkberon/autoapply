import { useCallback, useEffect, useState } from 'react'
import type { SavedPage } from '../../shared/types.ts'
import { api, timeAgo } from '../api.ts'

// Pages are re-checked on their own when the tab opens and they are older than this.
const STALE_MS = 6 * 60 * 60 * 1000

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function PageCard({ page, onChange, onDelete }: { page: SavedPage; onChange: (p: SavedPage) => void; onDelete: () => void }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(page.name)
  const [note, setNote] = useState(page.note)
  const [added, setAdded] = useState<Record<string, boolean>>({})

  const run = async (action: () => Promise<SavedPage>) => {
    setBusy(true)
    try {
      onChange(await action())
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    run(async () => {
      setEditing(false)
      return api.updatePage(page.id, { name, note })
    })

  const remove = async () => {
    if (!window.confirm(`Stop following ${page.name || host(page.url)}?`)) return
    await api.deletePage(page.id)
    onDelete()
  }

  const addJob = async (link: SavedPage['newLinks'][number]) => {
    await api.addLinkAsJob(page.id, { url: link.url, text: link.text })
    setAdded((a) => ({ ...a, [link.url]: true }))
  }

  const fresh = page.newLinks.length

  return (
    <section className="card page">
      <div className="page-head">
        <div className="page-title">
          {editing ? (
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Page name" autoFocus />
          ) : (
            <h2>
              {page.name || host(page.url)}
              {fresh > 0 && <span className="tag ok">{fresh} new</span>}
            </h2>
          )}
          <span className="muted small">
            {host(page.url)} ·{' '}
            {page.checkedAt
              ? `${page.linkCount} links, checked ${timeAgo(page.checkedAt)}`
              : 'not checked yet'}
            {page.changedAt && ` · last changed ${timeAgo(page.changedAt)}`}
          </span>
        </div>
        <div className="page-actions">
          <a className="button" href={page.url} target="_blank" rel="noreferrer">
            Open page
          </a>
          <button onClick={() => run(() => api.checkPage(page.id))} disabled={busy}>
            {busy ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      {editing ? (
        <textarea rows={2} value={note} placeholder="Notes, e.g. who to contact or what to look for" onChange={(e) => setNote(e.target.value)} />
      ) : (
        page.note && <p className="page-note">{page.note}</p>
      )}

      {page.error && <p className="banner warn">{page.error}</p>}

      {fresh > 0 && (
        <>
          <p className="small">
            <strong>New since you last looked:</strong>
          </p>
          <ul className="new-links">
            {page.newLinks.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noreferrer">
                  {link.text}
                </a>
                {link.onList || added[link.url] ? (
                  <span className="tag">On your job list</span>
                ) : (
                  <button className="link-add" onClick={() => addJob(link)}>
                    Add to my jobs
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {fresh === 0 && page.checkedAt && !page.error && (
        <p className="muted small">
          {page.changedAt
            ? 'Nothing new since you last looked.'
            : `Saved the ${page.linkCount} links on the page as your starting point. New postings will show up here when the page changes.`}
        </p>
      )}

      <div className="page-footer">
        {fresh > 0 && (
          <button className="primary" onClick={() => run(() => api.markPageSeen(page.id))} disabled={busy}>
            Mark as seen
          </button>
        )}
        {editing ? (
          <button onClick={save}>Save</button>
        ) : (
          <button onClick={() => setEditing(true)}>Rename or add a note</button>
        )}
        <button className="danger" onClick={remove}>
          Stop following
        </button>
      </div>
    </section>
  )
}

export function Links({ refresh }: { refresh: () => void }) {
  const [pages, setPages] = useState<SavedPage[] | null>(null)
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const checkAll = useCallback(async () => {
    setChecking(true)
    setPages(await api.checkAllPages())
    setChecking(false)
    refresh()
  }, [refresh])

  useEffect(() => {
    api.pages().then((list) => {
      setPages(list)
      const stale = list.some((p) => !p.checkedAt || Date.now() - new Date(p.checkedAt).getTime() > STALE_MS)
      if (stale) void checkAll()
    })
  }, [checkAll])

  const add = async () => {
    setAdding(true)
    setError('')
    try {
      const page = await api.addPage(url)
      setPages((list) => [page, ...(list ?? []).filter((p) => p.id !== page.id)])
      setUrl('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that page.')
    }
    setAdding(false)
  }

  const replace = (next: SavedPage) => {
    setPages((list) => (list ?? []).map((p) => (p.id === next.id ? next : p)))
    refresh()
  }

  if (!pages) return null
  const withNew = pages.filter((p) => p.newLinks.length > 0).length

  return (
    <>
      <h1>Links</h1>
      <p className="lead">
        Career pages that list several jobs and change over time, like a staffing agency's job board. Save one here and
        the app checks it for you, showing only the postings that are new since you last looked.
      </p>

      <section className="card">
        <label htmlFor="page-url">Follow a careers page</label>
        <div className="row">
          <input
            id="page-url"
            type="url"
            value={url}
            placeholder="https://example.com/careers"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url.trim() && add()}
          />
          <button className="primary" onClick={add} disabled={adding || !url.trim()}>
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {error && <p className="banner error">{error}</p>}
      </section>

      {pages.length > 0 && (
        <div className="links-bar">
          <span className="muted small">
            {pages.length} page{pages.length === 1 ? '' : 's'} followed
            {withNew > 0 ? ` · ${withNew} with new postings` : ''}
          </span>
          <button onClick={checkAll} disabled={checking}>
            {checking ? 'Checking all…' : 'Check all'}
          </button>
        </div>
      )}

      {pages.map((page) => (
        <PageCard
          key={page.id}
          page={page}
          onChange={replace}
          onDelete={() => {
            setPages((list) => (list ?? []).filter((p) => p.id !== page.id))
            refresh()
          }}
        />
      ))}

      {pages.length === 0 && (
        <p className="empty muted">
          No pages yet. Add one above; the first check saves what is on the page now, and later checks show what is new.
        </p>
      )}
    </>
  )
}

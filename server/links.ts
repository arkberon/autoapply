import crypto from 'node:crypto'
import { db, logEvent, now } from './db.ts'
import { classifyPending } from './areas.ts'
import { detectTarget } from './ats.ts'
import type { PageLink, SavedPage } from '../shared/types.ts'

// Saved career pages: pages that list several jobs (a staffing agency's board, a
// company careers page) and change over time. Each check records every link on
// the page; anything not there when the user last looked is shown as new.
// Navigation links repeat on every check, so in practice "new" means new postings.

db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL,
    checked_at TEXT,
    changed_at TEXT,
    error TEXT NOT NULL DEFAULT '',
    -- JSON arrays of { url, text }
    seen_links TEXT NOT NULL DEFAULT '[]',
    current_links TEXT NOT NULL DEFAULT '[]'
  );
`)

interface PageRow {
  id: number
  url: string
  name: string
  note: string
  added_at: string
  checked_at: string | null
  changed_at: string | null
  error: string
  seen_links: string
  current_links: string
}

const UA = 'Mozilla/5.0 (compatible; autoapply-personal/0.1; saved page check)'

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

const clean = (s: string) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Every distinct link on the page, resolved to a full URL, without same-page anchors, phone or mail links. */
export function extractLinks(html: string, base: string): PageLink[] {
  const body = html.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
  const page = new URL(base)
  const seen = new Map<string, string>()
  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1].trim())
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue
    let url: URL
    try {
      url = new URL(href, page)
    } catch {
      continue
    }
    url.hash = ''
    if (url.href === page.href) continue
    const text = clean(m[2])
    if (!seen.has(url.href) || (!seen.get(url.href) && text)) seen.set(url.href, text)
  }
  return [...seen].map(([url, text]) => ({ url, text: text || url }))
}

/** "Careers at Acme | Jobs" becomes "Acme", so jobs added from the page carry the company's name. */
export function companyFromTitle(title: string): string {
  return title
    .split(/\s[|·–—-]\s/)[0]
    .replace(/^(careers|jobs|open (positions|roles)|work)\s+(at|@|with)\s+/i, '')
    .replace(/\s+(careers|jobs)$/i, '')
    .trim()
}

function titleOf(html: string): string {
  return companyFromTitle(clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')).slice(0, 120)
}

function toPage(row: PageRow): SavedPage {
  const seen = new Set((JSON.parse(row.seen_links) as PageLink[]).map((l) => l.url))
  const current = JSON.parse(row.current_links) as PageLink[]
  const onList = db.prepare<[string], { id: string }>('SELECT id FROM jobs WHERE url = ?')
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    note: row.note,
    addedAt: row.added_at,
    checkedAt: row.checked_at,
    changedAt: row.changed_at,
    error: row.error,
    linkCount: current.length,
    newLinks: current.filter((l) => !seen.has(l.url)).map((l) => ({ ...l, onList: Boolean(onList.get(l.url)) })),
  }
}

export function listPages(): SavedPage[] {
  return db.prepare<[], PageRow>('SELECT * FROM pages ORDER BY changed_at IS NULL, changed_at DESC, name').all().map(toPage)
}

export function getPage(id: number): SavedPage | null {
  const row = db.prepare<[number], PageRow>('SELECT * FROM pages WHERE id = ?').get(id)
  return row ? toPage(row) : null
}

export async function checkPage(id: number): Promise<SavedPage | null> {
  const row = db.prepare<[number], PageRow>('SELECT * FROM pages WHERE id = ?').get(id)
  if (!row) return null
  try {
    const res = await fetch(row.url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(25_000) })
    if (!res.ok) throw new Error(`The page answered ${res.status}`)
    const html = (await res.text()).slice(0, 5_000_000)
    const links = extractLinks(html, res.url || row.url)
    const before = new Set((JSON.parse(row.current_links) as PageLink[]).map((l) => l.url))
    const firstCheck = row.checked_at === null
    const changed = !firstCheck && links.some((l) => !before.has(l.url))
    db.prepare(`
      UPDATE pages SET current_links = @links, checked_at = @at, error = @error,
        changed_at = CASE WHEN @changed THEN @at ELSE changed_at END,
        -- The first check sets the starting point; only later additions count as new.
        seen_links = CASE WHEN @first THEN @links ELSE seen_links END,
        name = CASE WHEN name = '' THEN @title ELSE name END
      WHERE id = @id
    `).run({
      id,
      links: JSON.stringify(links),
      at: now(),
      error:
        links.length < 5
          ? 'Very few links found. This page probably loads its jobs with JavaScript, so open it to check by hand.'
          : '',
      changed: changed ? 1 : 0,
      first: firstCheck ? 1 : 0,
      title: titleOf(html) || new URL(row.url).hostname,
    })
  } catch (err) {
    const message = err instanceof Error && err.name === 'TimeoutError' ? 'The page took too long to answer' : String(err instanceof Error ? err.message : err)
    db.prepare('UPDATE pages SET checked_at = ?, error = ? WHERE id = ?').run(now(), message, id)
  }
  return getPage(id)
}

export async function checkAllPages(): Promise<SavedPage[]> {
  const ids = db.prepare<[], { id: number }>('SELECT id FROM pages').all()
  await Promise.all(ids.map((p) => checkPage(p.id)))
  return listPages()
}

export async function addPage(url: string, name: string, note: string): Promise<SavedPage> {
  const normalized = new URL(url.trim()).href
  const existing = db.prepare<[string], { id: number }>('SELECT id FROM pages WHERE url = ?').get(normalized)
  if (existing) return getPage(existing.id)!
  const { lastInsertRowid } = db
    .prepare('INSERT INTO pages (url, name, note, added_at) VALUES (?, ?, ?, ?)')
    .run(normalized, name.trim(), note.trim(), now())
  logEvent(null, 'page_added', normalized)
  return (await checkPage(Number(lastInsertRowid)))!
}

export function updatePage(id: number, patch: { name?: string; note?: string }) {
  if (patch.name !== undefined) db.prepare('UPDATE pages SET name = ? WHERE id = ?').run(patch.name.trim(), id)
  if (patch.note !== undefined) db.prepare('UPDATE pages SET note = ? WHERE id = ?').run(patch.note.trim(), id)
  return getPage(id)
}

export function deletePage(id: number) {
  db.prepare('DELETE FROM pages WHERE id = ?').run(id)
}

/** "I've looked": everything currently on the page stops counting as new. */
export function markSeen(id: number) {
  db.prepare('UPDATE pages SET seen_links = current_links WHERE id = ?').run(id)
  return getPage(id)
}

/** Copies one link from a saved page onto the job list, so it can be prioritized and tracked like any other job. */
export function addLinkAsJob(pageId: number, link: PageLink): { id: string; added: boolean } {
  const page = getPage(pageId)
  if (!page) throw new Error('Page not found')
  const existing = db.prepare<[string], { id: string }>('SELECT id FROM jobs WHERE url = ?').get(link.url)
  if (existing) return { id: existing.id, added: false }

  const target = detectTarget(link.url)
  const id = `page_${crypto.createHash('sha1').update(link.url).digest('hex').slice(0, 12)}`
  const at = now()
  db.prepare(`
    INSERT INTO jobs (id, company, role, market, location, url, ats, mode, org, posting_id, fit, difficulty, priority,
      priority_reason, status, live, live_note, live_checked_at, last_checked, discovered_at, raw)
    VALUES (@id, @company, @role, '', '', @url, @ats, @mode, @org, @posting_id, 'Added from a saved page', '', 3,
      'Added from a saved page · check the requirements', 'not_started', 'open', 'Listed on a saved page', @at, @today, @at, @raw)
  `).run({
    id,
    company: page.name,
    // Drop the arrow or chevron that link lists often end with.
    role: link.text.replace(/\s*[↗→»›]+\s*$/u, '').slice(0, 200),
    url: link.url,
    ats: target.ats,
    mode: target.mode,
    org: target.org,
    posting_id: target.postingId,
    at,
    today: at.slice(0, 10),
    raw: JSON.stringify({ fromPage: page.url, ...link }),
  })
  logEvent(id, 'added_from_page', page.url)
  void classifyPending()
  return { id, added: true }
}

import { db } from './db.ts'

// When each job was posted. Jobs found by the search carry the date their source
// gives; the posting check fills it in for hosted boards; jobs imported from the
// sheet only have a free-text note, so a date is read from it when the note
// clearly says when the job was posted (never a "checked on" date).

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DATE = String.raw`(\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4})`

function toIso(text: string): string | null {
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return new Date(`${iso[0]}T12:00:00Z`).toISOString()
  const named = text.match(/([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/i)
  if (named) {
    const month = MONTHS.indexOf(named[1].toLowerCase())
    if (month >= 0) return new Date(Date.UTC(Number(named[3]), month, Number(named[2]), 12)).toISOString()
  }
  return null
}

const daysBefore = (iso: string, days: number) => new Date(new Date(iso).getTime() - days * 86_400_000).toISOString()

/** A posting date from the job sheet's freshness note, or null when the note does not give one. */
export function postedFromNote(note: string, lastChecked: string | null): string | null {
  const text = note.trim()
  if (!text) return null
  // The whole note is a date: that is the posting date.
  if (new RegExp(`^${DATE}\\.?$`, 'i').test(text)) return toIso(text)

  // "posted 7 days before Oct. 9, 2026"
  const before = text.match(new RegExp(`(\\d+) days? before ${DATE}`, 'i'))
  if (before) {
    const base = toIso(before[2])
    return base ? daysBefore(base, Number(before[1])) : null
  }

  // "posted 2026-09-02", "Recruiter publication: April 18, 2025", "first published Sep 3, 2026"
  const near = text.match(new RegExp(`(?:posted|published|publication|opened|date posted|listed on)[^.;]{0,30}?${DATE}`, 'i'))
  if (near) return toIso(near[1])

  // "posted 5 days ago" / "displayed 3 days ago", measured from the day the note was written.
  const ago = text.match(/(?:posted|displayed|listed|published)[^.;]{0,30}?(\d+)\+? days? ago/i)
  if (ago && lastChecked) return daysBefore(new Date(`${lastChecked.slice(0, 10)}T12:00:00Z`).toISOString(), Number(ago[1]))
  return null
}

/** Workday shows "Posted 5 Days Ago", "Posted Today", "Posted 30+ Days Ago". */
export function postedFromWorkday(text: string): string | null {
  const now = new Date().toISOString()
  if (/today/i.test(text)) return now
  if (/yesterday/i.test(text)) return daysBefore(now, 1)
  const days = text.match(/(\d+)\+?\s*days?/i)
  return days ? daysBefore(now, Number(days[1])) : null
}

/** Fills in posted_at for every job that has none yet, from what is already known about it. */
export function backfillPostedAt(): number {
  const rows = db
    .prepare<[], { id: string; raw: string; last_checked: string | null }>('SELECT id, raw, last_checked FROM jobs WHERE posted_at IS NULL')
    .all()
  const save = db.prepare('UPDATE jobs SET posted_at = ? WHERE id = ?')
  let filled = 0
  db.transaction(() => {
    for (const row of rows) {
      let raw: { publishedAt?: string | null; posting_freshness?: string | null } = {}
      try {
        raw = JSON.parse(row.raw)
      } catch {
        // Unreadable: leave the date unknown.
      }
      const posted = raw.publishedAt ?? postedFromNote(raw.posting_freshness ?? '', row.last_checked)
      if (posted && !Number.isNaN(new Date(posted).getTime())) {
        save.run(new Date(posted).toISOString(), row.id)
        filled++
      }
    }
  })()
  return filled
}

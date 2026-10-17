import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, getSetting } from './db.ts'

// Mac notifications and the short report saved after each live run.

const quote = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Shows a macOS notification. Does nothing elsewhere, or when notifications are off. */
export function notify(title: string, message: string): Promise<boolean> {
  if (process.platform !== 'darwin' || getSetting('notify_enabled', '1') !== '1') return Promise.resolve(false)
  const script = `display notification ${quote(message.slice(0, 220))} with title ${quote(title.slice(0, 80))}`
  return new Promise((resolve) => execFile('osascript', ['-e', script], (err) => resolve(!err)))
}

export interface RunReport {
  startedAt: string
  finishedAt: string
  trigger: 'schedule' | 'manual'
  applied: { company: string; role: string }[]
  needsYou: { company: string; role: string; reason: string }[]
  check: { company: string; role: string }[]
  closed: number
  failed: number
  note: string | null
}

/** One line for the notification: "Applied to 18 · 3 need you · 1 to check". */
export function summaryLine(r: RunReport): string {
  const parts = [`Applied to ${r.applied.length}`]
  if (r.needsYou.length) parts.push(`${r.needsYou.length} need you`)
  if (r.check.length) parts.push(`${r.check.length} to check`)
  if (r.failed) parts.push(`${r.failed} failed`)
  return parts.join(' · ')
}

/** Saves a readable report to data/reports/<date>.md, adding to it if the day already has one. */
export function saveReport(r: RunReport): string {
  const dir = path.join(DATA_DIR, 'reports')
  fs.mkdirSync(dir, { recursive: true })
  const day = new Date(r.startedAt).toLocaleDateString('en-CA')
  const file = path.join(dir, `${day}.md`)
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const lines = [
    `## ${r.trigger === 'schedule' ? 'Scheduled run' : 'Run'} at ${time(r.startedAt)}–${time(r.finishedAt)}`,
    '',
    `**${summaryLine(r)}**${r.closed ? ` · ${r.closed} posting${r.closed === 1 ? '' : 's'} had closed` : ''}`,
    r.note ? `\n${r.note}` : '',
    '',
    ...(r.applied.length ? ['### Applied', ...r.applied.map((j) => `- ${j.company}: ${j.role}`), ''] : []),
    ...(r.needsYou.length ? ['### Needs you', ...r.needsYou.map((j) => `- ${j.company}: ${j.role} (${j.reason})`), ''] : []),
    ...(r.check.length
      ? ['### Check the result', ...r.check.map((j) => `- ${j.company}: ${j.role} (submit was pressed, no confirmation seen)`), '']
      : []),
  ]
  const header = fs.existsSync(file) ? '' : `# Auto Apply report, ${day}\n\n`
  fs.appendFileSync(file, `${header}${lines.join('\n')}\n`)
  return file
}

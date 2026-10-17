import { getSetting, logEvent, now, setSetting } from './db.ts'
import { discoverProgress, startDiscover } from './discover.ts'
import { notify } from './notify.ts'
import { startVerify, verifyProgress } from './verify.ts'
import { agentProgress, startLive } from './agent/run.ts'
import type { ScheduleSettings } from '../shared/types.ts'

// The daily run: at the chosen time, find new jobs, re-check which postings are
// open, then apply up to the daily limit. It only runs while the app is open; if
// the app starts after the time, today's run happens then. Off until the user
// turns it on.

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const today = () => new Date().toLocaleDateString('en-CA')

export function scheduleSettings(): ScheduleSettings {
  return {
    enabled: getSetting('schedule_enabled', '0') === '1',
    time: getSetting('schedule_time', '09:00'),
    weekdaysOnly: getSetting('schedule_weekdays_only', '1') === '1',
    findFirst: getSetting('schedule_find_first', '1') === '1',
    notify: getSetting('notify_enabled', '1') === '1',
    lastRun: getSetting('schedule_last_date') || null,
    nextRun: nextRun(),
    running: running,
    step: step,
  }
}

export function saveScheduleSettings(patch: Partial<Pick<ScheduleSettings, 'enabled' | 'time' | 'weekdaysOnly' | 'findFirst' | 'notify'>>) {
  if (patch.enabled !== undefined) {
    setSetting('schedule_enabled', patch.enabled ? '1' : '0')
    // Turning it on later in the day should not fire straight away for a time already passed.
    if (patch.enabled && isPastTimeToday(patch.time ?? getSetting('schedule_time', '09:00'))) setSetting('schedule_last_date', today())
    logEvent(null, 'schedule', patch.enabled ? 'turned on' : 'turned off')
  }
  if (patch.time !== undefined) {
    setSetting('schedule_time', patch.time)
    // Moving the time to one already passed today never starts a run on the spot.
    if (getSetting('schedule_enabled', '0') === '1' && isPastTimeToday(patch.time)) setSetting('schedule_last_date', today())
  }
  if (patch.weekdaysOnly !== undefined) setSetting('schedule_weekdays_only', patch.weekdaysOnly ? '1' : '0')
  if (patch.findFirst !== undefined) setSetting('schedule_find_first', patch.findFirst ? '1' : '0')
  if (patch.notify !== undefined) setSetting('notify_enabled', patch.notify ? '1' : '0')
  return scheduleSettings()
}

function isPastTimeToday(time: string, at = new Date()): boolean {
  const [h, m] = time.split(':').map(Number)
  return at.getHours() * 60 + at.getMinutes() >= h * 60 + m
}

const allowedDay = (d: Date) => getSetting('schedule_weekdays_only', '1') !== '1' || (d.getDay() !== 0 && d.getDay() !== 6)

/** When the next daily run will start, as an ISO time, or null when the schedule is off. */
function nextRun(): string | null {
  if (getSetting('schedule_enabled', '0') !== '1') return null
  const [h, m] = getSetting('schedule_time', '09:00').split(':').map(Number)
  const d = new Date()
  const doneToday = getSetting('schedule_last_date') === today()
  for (let i = 0; i < 8; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h, m)
    if (!allowedDay(day)) continue
    if (i === 0 && doneToday) continue
    // Today's time has passed but it has not run yet: it runs at the next check.
    return (i === 0 && day < d ? d : day).toISOString()
  }
  return null
}

let running = false
let step: string | null = null

async function waitFor(isRunning: () => boolean, limitMs: number) {
  const until = Date.now() + limitMs
  while (isRunning() && Date.now() < until) await pause(2000)
}

/** The daily sequence. Exported so the Activity tab can show it running. */
export async function runDaily(): Promise<void> {
  if (running || agentProgress().running) return
  running = true
  setSetting('schedule_last_date', today())
  logEvent(null, 'schedule_run', `started ${now()}`)
  try {
    if (getSetting('schedule_find_first', '1') === '1') {
      step = 'Finding new jobs'
      startDiscover()
      await pause(500)
      await waitFor(() => discoverProgress().running, 15 * 60_000)

      step = 'Checking which postings are still open'
      startVerify()
      await pause(500)
      await waitFor(() => verifyProgress().running, 30 * 60_000)
    }

    step = 'Applying'
    const started = startLive(undefined, 'schedule')
    if (!started.running) {
      // Nothing to do today (limit reached or no jobs ready); say so instead of staying silent.
      await notify('Auto Apply: daily run', started.message ?? 'Nothing to apply to today.')
    }
    // The live run sends its own notification and report when it finishes.
  } catch (err) {
    await notify('Auto Apply: daily run failed', err instanceof Error ? err.message : String(err))
  } finally {
    running = false
    step = null
  }
}

export function startScheduler() {
  const tick = () => {
    if (getSetting('schedule_enabled', '0') !== '1' || running) return
    const d = new Date()
    if (getSetting('schedule_last_date') === today() || !allowedDay(d)) return
    if (isPastTimeToday(getSetting('schedule_time', '09:00'), d)) void runDaily()
  }
  setInterval(tick, 30_000)
  setTimeout(tick, 5_000)
}

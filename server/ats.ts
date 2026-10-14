import type { Mode } from '../shared/types.ts'

export interface Target {
  /** Short name of the application system the link lands on. */
  ats: string
  mode: Mode
  /** Company slug on the hosted board, when the URL carries one. */
  org: string | null
  postingId: string | null
}

// Job boards whose terms forbid automated use: the app never drives or scrapes these.
const NO_BOT_BOARDS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)indeed\.com$/, 'Indeed'],
  [/(^|\.)ziprecruiter\.com$/, 'ZipRecruiter'],
  [/(^|\.)ycombinator\.com$/, 'YC'],
  [/(^|\.)workatastartup\.com$/, 'YC'],
  [/(^|\.)wellfound\.com$/, 'Wellfound'],
  [/(^|\.)themuse\.com$/, 'The Muse'],
  [/(^|\.)idealist\.org$/, 'Idealist'],
  [/(^|\.)teamworkonline\.com$/, 'TeamWork Online'],
]

export const isNoBotBoard = (ats: string) => NO_BOT_BOARDS.some(([, name]) => name === ats)

// Smaller hosted systems: filled by the generic filler, always reviewed before submit.
const REVIEW_SYSTEMS: [RegExp, string][] = [
  [/\.applytojob\.com$/, 'JazzHR'],
  [/(^|\.)workable\.com$/, 'Workable'],
  [/\.bamboohr\.com$/, 'BambooHR'],
  [/\.teamtailor\.com$/, 'Teamtailor'],
  [/\.breezy\.hr$/, 'Breezy'],
  [/(^|\.)smartrecruiters\.com$/, 'SmartRecruiters'],
  [/(^|\.)rippling\.com$/, 'Rippling'],
  [/\.pinpointhq\.com$/, 'Pinpoint'],
  [/(^|\.)gem\.com$/, 'Gem'],
  [/(^|\.)adp\.com$/, 'ADP'],
  [/(^|\.)trinethire\.com$/, 'TriNet'],
]

export function detectTarget(rawUrl: string): Target {
  if (rawUrl.startsWith('mailto:')) {
    return { ats: 'Email', mode: 'email', org: null, postingId: null }
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ats: 'Unknown', mode: 'review', org: null, postingId: null }
  }
  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) {
    return { ats: 'Ashby', mode: 'auto', org: parts[0], postingId: parts[1] }
  }

  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const i = parts.indexOf('jobs')
    if (i >= 1 && parts[i + 1]) {
      return { ats: 'Greenhouse', mode: 'auto', org: parts[i - 1], postingId: parts[i + 1] }
    }
  }

  if (host === 'jobs.lever.co' && parts.length >= 2) {
    return { ats: 'Lever', mode: 'auto', org: parts[0], postingId: parts[1] }
  }

  if (host.endsWith('.myworkdayjobs.com')) {
    return { ats: 'Workday', mode: 'assist', org: host.split('.')[0], postingId: null }
  }

  for (const [re, name] of NO_BOT_BOARDS) {
    if (re.test(host)) return { ats: name, mode: 'manual', org: null, postingId: null }
  }
  // One recruiter intake covers every Bowman Williams role, so the 27 rows are a single form done by hand.
  if (/(^|\.)bowmanwilliams\.com$/.test(host)) {
    return { ats: 'Bowman Williams', mode: 'manual', org: null, postingId: null }
  }
  for (const [re, name] of REVIEW_SYSTEMS) {
    if (re.test(host)) return { ats: name, mode: 'review', org: null, postingId: null }
  }

  // A Greenhouse form embedded in the employer's own careers page: the board slug
  // is not in the URL, so it goes through the generic filler.
  const ghJid = url.searchParams.get('gh_jid')
  if (ghJid) return { ats: 'Greenhouse (embedded)', mode: 'review', org: null, postingId: ghJid }

  return { ats: 'Company site', mode: 'review', org: null, postingId: null }
}

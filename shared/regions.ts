// The cities the app searches and filters by, grouped into regions. Used by the
// job search (location filter and market labels) and by the Jobs tab's city filter.

export const REGIONS: { market: string; label: string; cities: string[] }[] = [
  { market: 'NYC', label: 'New York', cities: ['new york', 'nyc', 'brooklyn', 'manhattan', 'jersey city', 'hoboken'] },
  {
    market: 'SF Bay Area',
    label: 'SF Bay Area',
    cities: [
      'san francisco', 'sf', 'bay area', 'south san francisco', 'oakland', 'berkeley', 'emeryville', 'san mateo',
      'foster city', 'burlingame', 'redwood city', 'menlo park', 'palo alto', 'mountain view', 'sunnyvale',
      'santa clara', 'cupertino', 'san jose', 'milpitas', 'fremont', 'campbell', 'los gatos',
    ],
  },
  {
    market: 'Irvine, CA',
    label: 'Orange County / Irvine',
    cities: [
      'irvine', 'orange county', 'costa mesa', 'newport beach', 'santa ana', 'tustin', 'anaheim', 'lake forest',
      'aliso viejo', 'huntington beach',
    ],
  },
  {
    market: 'LA',
    label: 'Los Angeles',
    cities: [
      'los angeles', 'santa monica', 'culver city', 'venice', 'playa vista', 'marina del rey', 'el segundo',
      'hawthorne', 'manhattan beach', 'torrance', 'long beach', 'west hollywood', 'beverly hills', 'century city',
      'burbank', 'pasadena', 'santa clarita', 'thousand oaks', 'westlake village',
    ],
  },
  {
    market: 'San Diego',
    label: 'San Diego',
    cities: [
      'san diego', 'la jolla', 'sorrento valley', 'carlsbad', 'del mar', 'encinitas', 'oceanside', 'escondido',
      'poway', 'rancho bernardo', 'chula vista', 'san marcos',
    ],
  },
  { market: 'Miami', label: 'Miami', cities: ['miami', 'fort lauderdale'] },
]

export const REMOTE = 'US remote'
export const OTHER = 'Other'

/** Every city filter option, in display order, with its label. */
export const CITY_OPTIONS: { key: string; label: string }[] = [
  ...REGIONS.map((r) => ({ key: r.market, label: r.label })),
  { key: REMOTE, label: 'Remote (US)' },
  { key: OTHER, label: 'Other places' },
]

const words = (list: string[]) => new RegExp(`(^|[^a-z0-9])(${list.join('|')})($|[^a-z0-9])`, 'i')
const PATTERNS = REGIONS.map((r) => ({ market: r.market, re: words(r.cities) }))

/**
 * Every region a job is in. A posting that names several cities belongs to each,
 * so it shows under each city in the filter. The job sheet's own shorthand
 * ("LA metro — Orange County", "NYC / NJ") counts too.
 */
export function regionsOf(market: string, location: string): string[] {
  const found = new Set<string>()
  if (/\bNYC\b|new york|new jersey|\bNJ\b|long island/i.test(market)) found.add('NYC')
  // "LA" only in capitals, so La Jolla stays San Diego.
  if (/\bLA\b/.test(market) || /\bLA\b/.test(location) || /los angeles/i.test(market)) found.add('LA')
  if (/orange county|irvine/i.test(market)) found.add('Irvine, CA')
  if (/san diego/i.test(market)) found.add('San Diego')
  if (/sf bay area|san francisco/i.test(market)) found.add('SF Bay Area')
  if (/miami|fort lauderdale/i.test(market)) found.add('Miami')
  for (const { market: m, re } of PATTERNS) if (re.test(location)) found.add(m)
  if (/remote/i.test(market) || /remote/i.test(location)) found.add(REMOTE)
  return found.size ? [...found] : [OTHER]
}

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

// ── Cities and states, for the Jobs tab's City and State filters ──────────────

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([abbr, name]) => [name.toLowerCase(), abbr]))
const ABBRS = Object.keys(US_STATES).join('|')
const NAMES = Object.values(US_STATES)
  .sort((a, b) => b.length - a.length)
  .join('|')

/** The state each searched region is in; the few cities across a state line are listed separately. */
export const REGION_STATE: Record<string, string> = { NYC: 'NY', 'SF Bay Area': 'CA', 'Irvine, CA': 'CA', LA: 'CA', 'San Diego': 'CA', Miami: 'FL' }
const CITY_STATE: Record<string, string> = { 'jersey city': 'NJ', hoboken: 'NJ' }
/** Shorthand and neighbourhoods, written the way the filter shows them. */
const CITY_ALIASES: Record<string, string> = {
  nyc: 'New York', 'new york city': 'New York', manhattan: 'New York', sf: 'San Francisco', 'bay area': '',
  'orange county': '', 'sorrento valley': 'San Diego', 'rancho bernardo': 'San Diego', 'la jolla': 'San Diego',
  'playa vista': 'Los Angeles', 'century city': 'Los Angeles', venice: 'Los Angeles',
}
const SMALL_WORDS = new Set(['del', 'de', 'la', 'las', 'los', 'of', 'on', 'the'])

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
}

export interface Place {
  /** Display name, e.g. "Austin"; null when only the state is known. */
  city: string | null
  /** Two-letter state, e.g. "TX". */
  state: string
}

/** "Austin, TX" — the filter's label and key for a place. */
export const placeLabel = (p: Place) => (p.city ? `${p.city}, ${p.state}` : US_STATES[p.state])

const PAIR_ABBR = new RegExp(String.raw`((?:[A-Z][\w.'’-]*)(?:\s+(?:[A-Z][\w.'’-]*|del|de|la|las|los|of))*)\s*,\s*(${ABBRS})\b`, 'g')
const PAIR_NAME = new RegExp(String.raw`((?:[A-Z][\w.'’-]*)(?:\s+(?:[A-Z][\w.'’-]*|del|de|la|las|los|of))*)\s*,\s*(${NAMES})\b`, 'g')
const LONE_STATE = new RegExp(String.raw`\b(${NAMES})\b(?!\s+City)`, 'g')
const NOT_A_CITY = /^(remote|hybrid|onsite|on-site|united states|usa|us|u\.s\.|headquarters|hq|multiple locations)$/i
/** Big US tech cities, so "Seattle" or "Ann Arbor" without a state still lands in the right one. */
const MAJOR_CITIES: Record<string, string> = {
  seattle: 'WA', bellevue: 'WA', redmond: 'WA', kirkland: 'WA', austin: 'TX', dallas: 'TX', houston: 'TX',
  'san antonio': 'TX', plano: 'TX', irving: 'TX', boston: 'MA', cambridge: 'MA', chicago: 'IL', denver: 'CO',
  boulder: 'CO', 'ann arbor': 'MI', detroit: 'MI', atlanta: 'GA', pittsburgh: 'PA', philadelphia: 'PA',
  'washington dc': 'DC', arlington: 'VA', mclean: 'VA', reston: 'VA', baltimore: 'MD', raleigh: 'NC',
  durham: 'NC', charlotte: 'NC', nashville: 'TN', phoenix: 'AZ', tempe: 'AZ', scottsdale: 'AZ',
  'salt lake city': 'UT', lehi: 'UT', portland: 'OR', minneapolis: 'MN', columbus: 'OH', 'kansas city': 'MO',
  'st. louis': 'MO', 'st louis': 'MO', 'las vegas': 'NV', orlando: 'FL', tampa: 'FL', madison: 'WI',
  wichita: 'KS', omaha: 'NE', indianapolis: 'IN', 'new orleans': 'LA', sacramento: 'CA', 'washington, d.c.': 'DC',
}
const KNOWN_CITIES = [
  ...REGIONS.flatMap((r) => r.cities.map((c) => ({ city: c, state: CITY_STATE[c] ?? REGION_STATE[r.market] }))),
  ...Object.entries(MAJOR_CITIES).map(([city, state]) => ({ city, state })),
]
const KNOWN = words(KNOWN_CITIES.map((c) => c.city).sort((a, b) => b.length - a.length))

/**
 * Every US city and state a job names, read from its location text (and, for jobs
 * from the sheet, its market label). "Austin, TX; Remote" → Austin, TX.
 */
export function placesOf(market: string, location: string): Place[] {
  const found = new Map<string, Place>()
  const add = (city: string | null, state: string) => {
    // "Remote US excluding NY, CA, CO and WA" lists states, not cities.
    if (city && /^[A-Z]{2}$/.test(city.trim())) return
    // The sheet writes Los Angeles as LA: "Culver City, LA".
    if (state === 'LA' && city && KNOWN_CITIES.some((c) => c.city === city.trim().toLowerCase() && c.state === 'CA')) state = 'CA'
    let name = city?.trim().replace(/^(remote|hybrid)\s*[-–—:]\s*/i, '') ?? null
    if (name) {
      // Keep only the last few words before the comma: "Details specify NYC hybrid, despite … Kansas City".
      name = name.split(/\s+/).slice(-4).join(' ')
      const alias = CITY_ALIASES[name.toLowerCase()]
      if (alias !== undefined) name = alias || null
      if (name && NOT_A_CITY.test(name)) name = null
    }
    const place = { city: name ? titleCase(name) : null, state }
    found.set(placeLabel(place), place)
  }

  const text = location.replace(/\s+/g, ' ')
  for (const m of text.matchAll(PAIR_ABBR)) add(m[1], m[2])
  for (const m of text.matchAll(PAIR_NAME)) {
    // "Washington, District of Columbia" and "New York, New York" both work; a state name is never a city.
    const state = STATE_BY_NAME[m[2].toLowerCase()]
    add(STATE_BY_NAME[m[1].toLowerCase()] && m[1].toLowerCase() !== 'new york' && m[1].toLowerCase() !== 'washington' ? null : m[1], state)
  }
  // Cities the app knows without a state written next to them: "SF", "Sunnyvale", "NYC".
  const re = new RegExp(KNOWN.source, 'gi')
  for (const m of text.matchAll(re)) {
    const known = KNOWN_CITIES.find((c) => c.city === m[2].toLowerCase())!
    if (![...found.values()].some((p) => p.state === known.state && p.city?.toLowerCase() === titleCase(CITY_ALIASES[known.city] || known.city).toLowerCase())) {
      add(known.city, known.state)
    }
  }
  // A state named on its own ("California; Remote in USA", "Remote - Georgia").
  for (const m of text.matchAll(LONE_STATE)) {
    const state = STATE_BY_NAME[m[1].toLowerCase()]
    if (state === 'WA' && [...found.values()].some((p) => p.state === 'DC')) continue
    if (![...found.values()].some((p) => p.state === state)) add(null, state)
  }
  // Sheet jobs often say only "LA metro" or "NYC / NJ" in their market.
  if (!found.size) for (const r of regionsOf(market, '')) if (REGION_STATE[r]) add(null, REGION_STATE[r])
  // A city named twice ("New York" and "New York, NY") is listed once; drop state-only entries a city already covers.
  const places = [...found.values()]
  return places.filter((p) => p.city || !places.some((q) => q.city && q.state === p.state))
}

export const isRemote = (market: string, location: string) => /remote/i.test(market) || /remote/i.test(location)

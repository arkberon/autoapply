import { useCallback, useEffect, useState } from 'react'
import type { Summary } from '../shared/types.ts'
import { api } from './api.ts'
import { Home } from './pages/Home.tsx'
import { Activity } from './pages/Activity.tsx'
import { Jobs } from './pages/Jobs.tsx'
import { Links } from './pages/Links.tsx'
import { Settings } from './pages/Settings.tsx'
import { Setup } from './pages/Setup.tsx'

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="#2A2E35" />
      <path d="M8 15.5l4 4 8-10" fill="none" stroke="#8FB0FF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export type Tab = 'home' | 'setup' | 'jobs' | 'links' | 'activity' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Dashboard' },
  { id: 'setup', label: 'Setup' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'links', label: 'Links' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
]

function tabFromHash(): Tab {
  const hash = window.location.hash.slice(1)
  return TABS.some((t) => t.id === hash) ? (hash as Tab) : 'home'
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    api
      .summary()
      .then((s) => {
        setSummary(s)
        setError('')
      })
      .catch(() => setError('The app server is not answering. Start it again with "npm start".'))
  }, [])

  useEffect(refresh, [refresh, tab])

  // While a background check or job search runs, keep the numbers moving.
  const verifying = (summary?.verify.running || summary?.discover.running) ?? false
  useEffect(() => {
    if (!verifying) return
    const timer = setInterval(refresh, 1500)
    return () => clearInterval(timer)
  }, [verifying, refresh])

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (next: Tab) => {
    window.location.hash = next
    setTab(next)
  }

  const setupLeft = summary ? summary.setup.required - summary.setup.answered : 0

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
        <a className="brand" href="#home" onClick={() => go('home')} style={{ color: 'inherit', textDecoration: 'none' }}>
          <Logo />
          Auto Apply
        </a>
        <nav aria-label="Main">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => go(t.id)}>
              {t.label}
              {t.id === 'setup' && setupLeft > 0 && <span className="count">{setupLeft}</span>}
              {t.id === 'links' && (summary?.pages.withNew ?? 0) > 0 && <span className="count new">{summary!.pages.withNew}</span>}
            </button>
          ))}
        </nav>
        {summary && (
          <button className="model-pill" onClick={() => go('settings')} title={summary.llm.message}>
            <span className={summary.llm.ok ? 'dot ok' : summary.llm.message === 'Not tested yet.' ? 'dot' : 'dot warn'} aria-hidden="true" />
            {summary.llm.ok
              ? `Local model · ${summary.llm.model}`
              : summary.llm.message === 'Not tested yet.'
                ? 'Checking local model…'
                : 'Local model not connected'}
          </button>
        )}
        </div>
      </header>

      <main>
        {error && <p className="banner error">{error}</p>}
        {summary && tab === 'home' && <Home summary={summary} go={go} refresh={refresh} />}
        {tab === 'setup' && <Setup onSaved={refresh} />}
        {summary && tab === 'jobs' && <Jobs summary={summary} busy={verifying} refresh={refresh} />}
        {tab === 'links' && <Links refresh={refresh} />}
        {tab === 'activity' && <Activity />}
        {summary && tab === 'settings' && <Settings refresh={refresh} />}
      </main>
    </>
  )
}

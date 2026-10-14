import { useCallback, useEffect, useState } from 'react'
import type { Summary } from '../shared/types.ts'
import { api } from './api.ts'
import { Home } from './pages/Home.tsx'
import { Jobs } from './pages/Jobs.tsx'
import { Settings } from './pages/Settings.tsx'
import { Setup } from './pages/Setup.tsx'

export type Tab = 'home' | 'setup' | 'jobs' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'setup', label: 'Setup questions' },
  { id: 'jobs', label: 'Jobs' },
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

  // While the open-or-closed check runs in the background, keep the numbers moving.
  const verifying = summary?.verify.running ?? false
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
        <div className="brand">Auto Apply</div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => go(t.id)}>
              {t.label}
              {t.id === 'setup' && setupLeft > 0 && <span className="count">{setupLeft}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {error && <p className="banner error">{error}</p>}
        {summary && tab === 'home' && <Home summary={summary} go={go} refresh={refresh} />}
        {tab === 'setup' && <Setup onSaved={refresh} />}
        {summary && tab === 'jobs' && <Jobs verifying={verifying} />}
        {summary && tab === 'settings' && <Settings refresh={refresh} />}
      </main>
    </>
  )
}

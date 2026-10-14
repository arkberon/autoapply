import { useEffect, useState } from 'react'
import type { DiscoverSettings, LlmStatus, ResumeInfo } from '../../shared/types.ts'
import { api, timeAgo, type Settings as SettingsData } from '../api.ts'

const SERVERS = [
  { name: 'Ollama', url: 'http://localhost:11434/v1' },
  { name: 'LM Studio', url: 'http://localhost:1234/v1' },
  { name: 'MLX', url: 'http://localhost:8080/v1' },
]

export function Settings({ refresh }: { refresh: () => void }) {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [resume, setResume] = useState<ResumeInfo | null>(null)
  const [llm, setLlm] = useState<LlmStatus | null>(null)
  const [busy, setBusy] = useState<'' | 'resume' | 'llm' | 'import'>('')
  const [resumeError, setResumeError] = useState('')
  const [importNote, setImportNote] = useState('')
  const [search, setSearch] = useState<DiscoverSettings | null>(null)
  const [searchDefaults, setSearchDefaults] = useState<DiscoverSettings | null>(null)
  const [searchNote, setSearchNote] = useState('')
  const [boardUrl, setBoardUrl] = useState('')
  const [boardNote, setBoardNote] = useState('')

  useEffect(() => {
    api.discoverSettings().then(({ defaults, ...current }) => {
      setSearch(current)
      setSearchDefaults(defaults)
    })
    api.settings().then(setSettings)
    api.summary().then((s) => {
      setResume(s.resume)
      setLlm(s.llm)
    })
  }, [])

  if (!settings) return null
  const set = (patch: Partial<SettingsData>) => setSettings({ ...settings, ...patch })

  const saveResume = async () => {
    setBusy('resume')
    setResumeError('')
    try {
      await api.saveSettings({ resumeDocUrl: settings.resumeDocUrl })
      setResume(await api.syncResume())
      setSettings(await api.settings())
    } catch (err) {
      setResumeError(err instanceof Error ? err.message : 'Could not save the link.')
    }
    setBusy('')
    refresh()
  }

  const testLlm = async (patch: Partial<SettingsData> = {}) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    setBusy('llm')
    await api.saveSettings({ llmBaseUrl: next.llmBaseUrl, llmModel: next.llmModel })
    setLlm(await api.testLlm())
    setBusy('')
    refresh()
  }

  const saveSearch = async (next: DiscoverSettings) => {
    setSearch(await api.saveDiscoverSettings(next))
    setSearchNote('Saved. The next search uses these filters.')
  }

  const addBoard = async () => {
    try {
      const { board, boards } = await api.addBoard(boardUrl)
      setBoardNote(`Added ${board.org} (${board.ats}). Now watching ${boards} company boards.`)
      setBoardUrl('')
      refresh()
    } catch (err) {
      setBoardNote(err instanceof Error ? err.message : 'Could not add that board.')
    }
  }

  const reimport = async () => {
    setBusy('import')
    const result = await api.reimport()
    setImportNote(`${result.jobs} jobs read from the sheet, ${result.added} new. Your progress and priorities were kept.`)
    setBusy('')
    refresh()
  }

  return (
    <>
      <h1>Settings</h1>

      <section className="card">
        <h2>Resume</h2>
        <p className="muted small section-note">
          Paste the Google Docs link to your resume. The app downloads a fresh PDF before every application run, so
          editing the document is all you need to do to update it. The document must be shared as "Anyone with the link
          can view".
        </p>
        <div className="row">
          <input
            type="url"
            value={settings.resumeDocUrl}
            placeholder="https://docs.google.com/document/d/…"
            onChange={(e) => set({ resumeDocUrl: e.target.value })}
          />
          <button className="primary" onClick={saveResume} disabled={busy === 'resume'}>
            {busy === 'resume' ? 'Syncing…' : 'Save and sync'}
          </button>
        </div>
        {(resumeError || resume?.error) && <p className="banner error">{resumeError || resume?.error}</p>}
        {resume?.pdf && !resume.error && (
          <p className="muted small">
            Synced {timeAgo(resume.syncedAt)}. The document last changed {timeAgo(resume.changedAt)}.{' '}
            <a href="/api/resume/file" target="_blank" rel="noreferrer">
              View the PDF the app will upload
            </a>
          </p>
        )}
      </section>

      <section className="card">
        <h2>Local model</h2>
        <p className="muted small section-note">
          A model running on this computer matches each form's questions to your saved answers and drafts short written
          answers. Nothing about you is sent to an AI service. Install a model runner such as Ollama, download a model of
          roughly 12 to 30 billion parameters (for example <code>ollama pull qwen3.8:27b</code>), then test the connection
          here.
        </p>

        <label htmlFor="llm-url">Model server address</label>
        <div className="row">
          <input id="llm-url" type="url" value={settings.llmBaseUrl} onChange={(e) => set({ llmBaseUrl: e.target.value })} />
          <button className="primary" onClick={() => testLlm()} disabled={busy === 'llm'}>
            {busy === 'llm' ? 'Testing…' : 'Test connection'}
          </button>
        </div>
        <div className="chips">
          {SERVERS.map((s) => (
            <button
              key={s.name}
              className={settings.llmBaseUrl === s.url ? 'chip active' : 'chip'}
              onClick={() => testLlm({ llmBaseUrl: s.url })}
            >
              {s.name}
            </button>
          ))}
        </div>

        {llm && llm.models.length > 0 && (
          <>
            <label htmlFor="llm-model">Model</label>
            <select id="llm-model" value={settings.llmModel} onChange={(e) => testLlm({ llmModel: e.target.value })}>
              <option value="">Choose a model…</option>
              {llm.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </>
        )}
        {llm && <p className={llm.ok ? 'banner ok' : 'banner warn'}>{llm.message}</p>}
      </section>

      {search && searchDefaults && (
        <section className="card">
          <h2>Finding new jobs</h2>
          <p className="muted small section-note">
            "Find new jobs" on the Jobs tab searches the job boards of every company on your list and adds openings that
            pass these filters. Separate words with commas.
          </p>
          <div className="fields">
            <div className="field">
              <label htmlFor="d-include">Title must include one of</label>
              <textarea id="d-include" rows={3} value={search.include} onChange={(e) => setSearch({ ...search, include: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="d-exclude">Skip titles with any of</label>
              <textarea id="d-exclude" rows={3} value={search.exclude} onChange={(e) => setSearch({ ...search, exclude: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="d-locations">Location must mention one of</label>
              <textarea id="d-locations" rows={3} value={search.locations} onChange={(e) => setSearch({ ...search, locations: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="d-age">Only postings from the last (days)</label>
              <input
                id="d-age"
                type="text"
                inputMode="numeric"
                value={search.maxAgeDays}
                onChange={(e) => setSearch({ ...search, maxAgeDays: Number(e.target.value.replace(/\D/g, '')) || 0 })}
              />
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="primary" onClick={() => saveSearch({ ...search, maxAgeDays: Math.max(1, search.maxAgeDays) })}>
              Save filters
            </button>
            <button onClick={() => saveSearch(searchDefaults)}>Reset to defaults</button>
          </div>
          {searchNote && <p className="muted small">{searchNote}</p>}

          <label htmlFor="d-board" style={{ marginTop: 18 }}>
            Watch another company
          </label>
          <div className="row">
            <input
              id="d-board"
              type="url"
              value={boardUrl}
              placeholder="https://jobs.ashbyhq.com/company or a Greenhouse / Lever board link"
              onChange={(e) => setBoardUrl(e.target.value)}
            />
            <button onClick={addBoard} disabled={!boardUrl.trim()}>
              Add
            </button>
          </div>
          {boardNote && <p className="muted small">{boardNote}</p>}
        </section>
      )}

      <section className="card">
        <h2>Job sheet</h2>
        <p className="muted small section-note">
          Reads the job list again after the sheet changes. Applications already sent, posting checks, priorities you
          set by hand and jobs you removed are kept.
        </p>
        <button onClick={reimport} disabled={busy === 'import'}>
          {busy === 'import' ? 'Reading…' : 'Re-import job sheet'}
        </button>
        {importNote && <p className="muted small">{importNote}</p>}
      </section>
    </>
  )
}

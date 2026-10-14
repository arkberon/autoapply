import { useState, type ReactNode } from 'react'
import { MODE_HELP, MODE_LABEL, PRIORITY_LABEL, type Mode, type Priority, type Summary } from '../../shared/types.ts'
import { api, timeAgo } from '../api.ts'
import type { Tab } from '../App.tsx'

interface Props {
  summary: Summary
  go: (tab: Tab) => void
  refresh: () => void
}

function Step(props: { done: boolean; title: string; detail: ReactNode; children?: ReactNode }) {
  return (
    <li className={props.done ? 'step done' : 'step'}>
      <span className="step-mark" aria-hidden>
        {props.done ? '✓' : ''}
      </span>
      <div className="step-text">
        <strong>{props.title}</strong>
        <span className="muted">{props.detail}</span>
      </div>
      <div className="step-actions">{props.children}</div>
    </li>
  )
}

const MODES: Mode[] = ['auto', 'review', 'assist', 'manual', 'email']
const PRIORITIES: Priority[] = [1, 2, 3, 4]

export function Home({ summary, go, refresh }: Props) {
  const [syncing, setSyncing] = useState(false)
  const [testing, setTesting] = useState(false)
  const { setup, resume, llm, verify, byLive } = summary

  const setupDone = setup.answered === setup.required
  const resumeDone = Boolean(resume.pdf) && !resume.error
  const checked = Boolean(summary.lastChecked)
  const applied = summary.byStatus.applied ?? 0

  const syncResume = async () => {
    setSyncing(true)
    await api.syncResume().catch(() => undefined)
    setSyncing(false)
    refresh()
  }

  const testModel = async () => {
    setTesting(true)
    await api.testLlm().catch(() => undefined)
    setTesting(false)
    refresh()
  }

  const startVerify = async () => {
    await api.startVerify()
    refresh()
  }

  const missing = setup.missing.slice(0, 3).join(', ') + (setup.missing.length > 3 ? `, and ${setup.missing.length - 3} more` : '')

  return (
    <>
      <h1>Get ready to apply</h1>
      <p className="lead">
        {summary.jobs} jobs on your list, {applied} applied. Finish these four steps once and the app can start working
        through them.
      </p>

      <ol className="steps card">
        <Step
          done={setupDone}
          title="Answer the setup questions"
          detail={
            setupDone
              ? `All ${setup.required} answered. They are reused on every application.`
              : `${setup.answered} of ${setup.required} answered. Still needed: ${missing}.`
          }
        >
          <button className={setupDone ? '' : 'primary'} onClick={() => go('setup')}>
            {setupDone ? 'Review answers' : 'Answer questions'}
          </button>
        </Step>

        <Step
          done={resumeDone}
          title="Resume"
          detail={
            resume.error
              ? resume.error
              : resume.pdf
                ? `Synced from your Google Doc ${timeAgo(resume.syncedAt)}. It is re-synced before every application run.`
                : 'Not synced yet.'
          }
        >
          {resume.pdf && (
            <a className="button" href="/api/resume/file" target="_blank" rel="noreferrer">
              View
            </a>
          )}
          <button onClick={syncResume} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </Step>

        <Step done={llm.ok} title="Local model" detail={testing ? 'Waking the model; the first reply can take a minute…' : llm.message}>
          <button onClick={() => go('settings')}>{llm.ok ? 'Change' : 'Settings'}</button>
          {!llm.ok && (
            <button className="primary" onClick={testModel} disabled={testing}>
              {testing ? 'Testing…' : 'Test again'}
            </button>
          )}
        </Step>

        <Step
          done={checked && !verify.running}
          title="Check which jobs are still open"
          detail={
            verify.running
              ? `Checking ${verify.done} of ${verify.total}…`
              : checked
                ? `${byLive.open ?? 0} open, ${byLive.closed ?? 0} closed, ${byLive.unknown ?? 0} to check by hand. Last checked ${timeAgo(summary.lastChecked)}.`
                : 'Not checked yet. Postings close quickly, so run this before applying.'
          }
        >
          <button className={checked ? '' : 'primary'} onClick={startVerify} disabled={verify.running}>
            {verify.running ? 'Checking…' : checked ? 'Check again' : 'Check now'}
          </button>
        </Step>
      </ol>

      <h2>Your list by priority</h2>
      <div className="tiles">
        {PRIORITIES.map((p) => (
          <button key={p} className="tile" onClick={() => go('jobs')}>
            <span className={`pill p${p}`}>Priority {p}</span>
            <span className="tile-number">{summary.byPriority[p] ?? 0}</span>
            <span className="muted">{PRIORITY_LABEL[p]}</span>
          </button>
        ))}
      </div>
      <p className="muted small">
        Nothing is skipped. Priority comes from how well your resume fits and how hard the role is to land; change any
        job's priority on the Jobs tab.
      </p>

      <h2>How each job gets applied</h2>
      <ul className="modes card">
        {MODES.map((m) => (
          <li key={m}>
            <span className="mode-count">{summary.byMode[m] ?? 0}</span>
            <div>
              <strong>{MODE_LABEL[m]}</strong>
              <span className="muted">{MODE_HELP[m]}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

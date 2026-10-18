import { useState } from 'react'
import { api } from '../api.ts'

/**
 * Opens the application in a Chrome window with every answer the agent knows already
 * filled in, then leaves it for you to check and submit. Falls back to the plain link
 * if the window can't be opened.
 */
export function OpenFormButton({ jobId, url, label = 'Open filled form' }: { jobId: string; url: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'filling' | 'done' | 'failed'>('idle')
  const [note, setNote] = useState('')

  const open = async () => {
    setState('filling')
    setNote('')
    try {
      const { outcome, reasons } = await api.openForm(jobId)
      setState('done')
      setNote(
        outcome === 'closed'
          ? 'The posting is gone.'
          : reasons.length
            ? `Filled in the Chrome window. Still needs you: ${reasons.join('; ')}`
            : 'Filled in the Chrome window. Check it over, then press Submit there.',
      )
    } catch (err) {
      setState('failed')
      setNote(`${err instanceof Error ? err.message : String(err)}. Opened the blank form instead.`)
      window.open(url, '_blank', 'noreferrer')
    }
  }

  return (
    <>
      <button onClick={open} disabled={state === 'filling'} title="Fills the form in a Chrome window and stops before submit">
        {state === 'filling' ? 'Filling…' : label}
      </button>
      {note && <span className={`muted small open-form-note${state === 'failed' ? ' warn' : ''}`}>{note}</span>}
    </>
  )
}

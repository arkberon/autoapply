import { useEffect, useMemo, useState } from 'react'
import type { Answer, Question } from '../../shared/types.ts'
import { api } from '../api.ts'

type Values = Record<string, { value: string; source: Answer['source'] | null }>

function Field(props: {
  question: Question
  value: string
  source: Answer['source'] | null
  onSave: (value: string) => Promise<void>
}) {
  const { question: q, source } = props
  const [draft, setDraft] = useState(props.value)
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle')

  const save = async (value: string) => {
    if (value.trim() === props.value) return
    try {
      await props.onSave(value)
      setState('saved')
      setTimeout(() => setState('idle'), 1500)
    } catch {
      setState('error')
    }
  }

  const needed = q.required && !props.value
  const id = `q-${q.key}`
  const common = { id, value: draft, placeholder: q.placeholder }

  return (
    <div className={needed ? 'field needed' : 'field'}>
      <label htmlFor={id}>
        {q.label}
        {needed && <span className="tag warn">Needed</span>}
        {!needed && !q.required && !props.value && <span className="tag">Optional</span>}
        {props.value && source === 'resume' && <span className="tag">From your resume</span>}
        {props.value && source === 'default' && <span className="tag">Default</span>}
        {state === 'saved' && <span className="tag ok">Saved</span>}
        {state === 'error' && <span className="tag warn">Not saved</span>}
      </label>

      {q.type === 'select' ? (
        <select
          id={id}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            void save(e.target.value)
          }}
        >
          <option value="">Choose…</option>
          {q.options!.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : q.type === 'textarea' ? (
        <textarea {...common} rows={3} onChange={(e) => setDraft(e.target.value)} onBlur={() => save(draft)} />
      ) : (
        <input
          {...common}
          type={q.type === 'number' ? 'text' : q.type}
          inputMode={q.type === 'number' ? 'numeric' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save(draft)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      )}
      {q.help && <p className="help">{q.help}</p>}
    </div>
  )
}

export function Setup({ onSaved }: { onSaved: () => void }) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [values, setValues] = useState<Values>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api.questions().then((data) => {
      setQuestions(data.questions)
      setNotes(data.sectionNotes)
      setValues(Object.fromEntries(data.answers.map((a) => [a.key, { value: a.value, source: a.source }])))
      setLoaded(true)
    })
  }, [])

  const sections = useMemo(() => {
    const map = new Map<string, Question[]>()
    for (const q of questions) map.set(q.section, [...(map.get(q.section) ?? []), q])
    return [...map.entries()]
  }, [questions])

  const required = questions.filter((q) => q.required)
  const answered = required.filter((q) => values[q.key]?.value).length

  const save = async (key: string, value: string) => {
    await api.saveAnswer(key, value)
    setValues((v) => ({ ...v, [key]: { value: value.trim(), source: 'you' } }))
    onSaved()
  }

  if (!loaded) return null

  return (
    <>
      <h1>Setup questions</h1>
      <p className="lead">
        Answer these once. The app reuses them on every application and never guesses: if a form asks something that is
        not answered here, it stops and asks you. Changes save as you go.
      </p>

      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={answered}>
        <div style={{ width: `${(answered / Math.max(required.length, 1)) * 100}%` }} />
      </div>
      <p className="muted small">
        {answered} of {required.length} needed answers filled in
        {answered === required.length ? '. You are set.' : '.'}
      </p>

      {sections.map(([section, qs]) => (
        <section key={section} className="card">
          <h2>{section}</h2>
          {notes[section] && <p className="muted small section-note">{notes[section]}</p>}
          <div className="fields">
            {qs.map((q) => (
              <Field
                key={q.key}
                question={q}
                value={values[q.key]?.value ?? ''}
                source={values[q.key]?.source ?? null}
                onSave={(value) => save(q.key, value)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

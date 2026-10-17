// Runs inside the application page (via page.evaluate), so it must not use
// anything from outside this function. It lists every question on the form,
// tags each control with data-aa="<id>" so the filler can find it again, and
// returns what a person would see: the question text, its type, its choices
// and whether it is required.

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'select'
  | 'combobox'
  | 'radio'
  | 'checkboxes'
  | 'checkbox'
  | 'buttons'
  | 'file'

export interface FormField {
  id: string
  kind: FieldKind
  label: string
  required: boolean
  options: string[]
  /** The input's own type or name, which helps tell a phone field from a text field. */
  hint: string
}

export function extractFields(start = 0): FormField[] {
  const clean = (s: string | null | undefined) =>
    (s ?? '').replace(/[*✱]/g, ' ').replace(/\s+/g, ' ').trim()

  const visible = (el: Element) => {
    const box = (el as HTMLElement).getBoundingClientRect()
    const style = getComputedStyle(el as HTMLElement)
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }

  // The element that holds one whole question on each of the systems we support.
  const CONTAINER = [
    '.application-question',
    '[class*="_fieldEntry"]',
    '.field-wrapper',
    '.select__container',
    '[class*="question"]',
    'fieldset',
    '.field',
  ].join(',')

  const containerOf = (el: Element) => el.closest(CONTAINER)

  const questionText = (el: Element): string => {
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const text = clean(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '))
      if (text) return text
    }
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
      const text = clean(label?.textContent)
      if (text && !['radio', 'checkbox'].includes((el as HTMLInputElement).type)) return text
    }
    const box = containerOf(el)
    if (box) {
      // Most specific first: a plain <label> can wrap hint text and error messages too.
      for (const selector of ['legend', '.application-label', '[class*="question-title"]', '[class*="_heading"]', 'label[class*="label"]', 'label', '[class*="label"]']) {
        const text = clean(box.querySelector(selector)?.textContent)
        if (text) return text
      }
    }
    return clean(el.getAttribute('aria-label') || (el as HTMLInputElement).placeholder || (el as HTMLInputElement).name)
  }

  const optionText = (input: HTMLInputElement): string => {
    const byFor = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null
    return clean(byFor?.textContent || input.closest('label')?.textContent || input.value)
  }

  const isRequired = (el: Element, label: string): boolean => {
    if ((el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true') return true
    const box = containerOf(el)
    const raw = box?.textContent ?? ''
    return /[*✱]/.test(raw.slice(0, label.length + 40)) || Boolean(box?.querySelector('[class*="required"]'))
  }

  const fields: FormField[] = []
  const done = new Set<Element>(document.querySelectorAll('[data-aa]'))
  // Controls inside an already-tagged group (Ashby's Yes/No buttons) are known too.
  document.querySelectorAll('[data-aa] input').forEach((e) => done.add(e))
  let n = start
  // The question's surrounding box is tagged too: some forms rebuild the input
  // itself after an answer (dropdowns, file uploads), but keep the box.
  const tagBox = (el: Element, id: string) => {
    const box = containerOf(el)
    if (box && !box.hasAttribute('data-aa-box')) box.setAttribute('data-aa-box', id)
  }
  const tag = (el: Element) => {
    const id = `f${n++}`
    el.setAttribute('data-aa', id)
    tagBox(el, id)
    return id
  }

  const controls = document.querySelectorAll<HTMLElement>('input, textarea, select, [role="combobox"]')
  for (const el of controls) {
    if (done.has(el)) continue
    const input = el as HTMLInputElement
    const type = (input.type || '').toLowerCase()
    if (['hidden', 'submit', 'button', 'image', 'reset', 'search'].includes(type)) continue
    if (/recaptcha|captcha/i.test(input.name || input.id || '')) continue
    if (el.closest('[aria-hidden="true"]') && type !== 'file') continue

    // Radio and checkbox groups become one question with choices.
    if (type === 'radio' || type === 'checkbox') {
      const group = input.name
        ? [...document.querySelectorAll<HTMLInputElement>(`input[type="${type}"][name="${CSS.escape(input.name)}"]`)]
        : [input]
      group.forEach((g) => done.add(g))

      // Ashby draws Yes/No questions as two buttons over a hidden checkbox.
      const box = containerOf(input)
      const buttons = box ? [...box.querySelectorAll('button')].filter((b) => /^(yes|no)$/i.test(clean(b.textContent))) : []
      if (type === 'checkbox' && group.length === 1 && buttons.length >= 2) {
        const id = tag(box!)
        fields.push({
          id,
          kind: 'buttons',
          label: questionText(input),
          required: isRequired(input, questionText(input)),
          options: buttons.map((b) => clean(b.textContent)),
          hint: 'yes-no',
        })
        continue
      }

      // Some forms give each tick-box of one question its own name; join them back up.
      const previous = fields[fields.length - 1]
      if (type === 'checkbox' && group.length === 1 && previous && (previous.kind === 'checkbox' || previous.kind === 'checkboxes') && previous.hint === `checkbox:${questionText(input)}`) {
        input.setAttribute('data-aa', previous.id)
        if (previous.kind === 'checkbox') {
          previous.kind = 'checkboxes'
          previous.label = questionText(input)
        }
        previous.options.push(optionText(input))
        previous.required = previous.required || isRequired(input, previous.label)
        continue
      }

      const id = `f${n++}`
      group.forEach((g) => g.setAttribute('data-aa', id))
      tagBox(input, id)
      const options = group.map(optionText)
      const label =
        group.length === 1 && type === 'checkbox'
          ? clean(`${questionText(input)} ${options[0]}`)
          : questionText(input)
      fields.push({
        id,
        kind: type === 'radio' ? 'radio' : group.length === 1 ? 'checkbox' : 'checkboxes',
        label,
        required: group.some((g) => g.required) || isRequired(input, label),
        options,
        hint: type === 'checkbox' && group.length === 1 ? `checkbox:${questionText(input)}` : type,
      })
      continue
    }

    done.add(el)
    if (type !== 'file' && !visible(el)) continue
    const label = questionText(el)
    if (!label) continue

    if (type === 'file') {
      fields.push({ id: tag(el), kind: 'file', label, required: isRequired(el, label), options: [], hint: input.name || input.id })
      continue
    }
    if (el.tagName === 'SELECT') {
      const options = [...(el as HTMLSelectElement).options].map((o) => clean(o.textContent)).filter((o) => o && !/^(select|choose|--)/i.test(o))
      fields.push({ id: tag(el), kind: 'select', label, required: isRequired(el, label), options, hint: input.name })
      continue
    }
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') || el.getAttribute('aria-haspopup') === 'listbox') {
      fields.push({ id: tag(el), kind: 'combobox', label, required: isRequired(el, label), options: [], hint: input.name || input.id })
      continue
    }
    fields.push({
      id: tag(el),
      kind: el.tagName === 'TEXTAREA' ? 'textarea' : 'text',
      label,
      required: isRequired(el, label),
      options: [],
      hint: `${type || 'text'} ${input.name || input.id || ''}`.trim(),
    })
  }
  return fields
}

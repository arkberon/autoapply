import type { Page } from 'playwright-core'
import type { FormField } from './extract.ts'
import type { Decision } from './resolve.ts'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const at = (page: Page, f: FormField) => page.locator(`[data-aa="${f.id}"]`)
/** The field's input, or the input now inside its question box if the page rebuilt it. */
const inputOf = (page: Page, f: FormField) =>
  page.locator(`[data-aa="${f.id}"], [data-aa-box="${f.id}"] input:not([type="hidden"]):not([type="file"])`)

/** Visible dropdown options while a combobox is open. */
async function openOptions(page: Page): Promise<string[]> {
  return page
    .locator('[role="option"]')
    .evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLElement).getBoundingClientRect().height > 0)
        .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    )
}

/** Opens a dropdown even when the page lays another element over its input. */
async function openCombobox(page: Page, box: ReturnType<Page['locator']>) {
  await box.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined)
  await box.focus({ timeout: 4000 })
  await page.keyboard.press('ArrowDown')
  await pause(400)
}

/** Opens each combobox once to learn its choices, since they are not in the page until opened. */
export async function readComboboxOptions(page: Page, f: FormField): Promise<string[]> {
  const box = at(page, f).first()
  try {
    await openCombobox(page, box)
    const options = await openOptions(page)
    await page.keyboard.press('Escape')
    return options.slice(0, 300)
  } catch {
    return []
  }
}

/** Fills one field. Returns a note when the value could not be entered as intended. */
export async function fillField(page: Page, d: Decision): Promise<string | null> {
  const f = d.field
  const value = d.values[0] ?? ''
  const el = at(page, f)
  try {
    switch (f.kind) {
      case 'text':
      case 'textarea':
        await el.first().fill(value, { timeout: 5000 })
        return null

      case 'file':
        await el.first().setInputFiles(value, { timeout: 10000 })
        await pause(1500)
        return null

      case 'select':
        await el.first().selectOption({ label: value }, { timeout: 5000 })
        return null

      case 'radio':
      case 'checkboxes':
      case 'checkbox': {
        for (const v of d.values) {
          const index = f.options.indexOf(v)
          await el.nth(Math.max(0, index)).check({ force: true, timeout: 5000 })
        }
        return null
      }

      case 'buttons':
        await el.first().getByRole('button', { name: value, exact: true }).click({ timeout: 5000 })
        return null

      case 'combobox': {
        const box = inputOf(page, f).first()
        await openCombobox(page, box)
        // Type-ahead fields (like a city search) need text before they show choices.
        const search = f.options.length ? value : value.split(',')[0]
        await box.pressSequentially(search, { delay: 30, timeout: 10000 })
        await pause(1200)
        const options = await openOptions(page)
        const want = norm(value)
        const pick =
          options.find((o) => norm(o) === want) ??
          options.find((o) => norm(o).startsWith(want) || want.startsWith(norm(o))) ??
          options.find((o) => norm(o).includes(norm(search)))
        if (!pick) {
          await page.keyboard.press('Escape')
          return `No choice matched "${value}"`
        }
        await page.locator('[role="option"]:visible', { hasText: pick }).first().click({ timeout: 5000, force: true })
        await pause(200)
        return null
      }
    }
  } catch (err) {
    return err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)
  }
  return null
}

/** Required fields that are still empty after filling, by their question text. */
export async function emptyRequired(page: Page, fields: FormField[]): Promise<string[]> {
  const missing: string[] = []
  for (const f of fields.filter((x) => x.required)) {
    const filled = await page
      .evaluate(
        ({ id, kind }) => {
          const box = document.querySelector(`[data-aa-box="${id}"]`)
          const own = [...document.querySelectorAll(`[data-aa="${id}"]`)]
          const scope: Element[] = box ? [box] : own
          const any = (fn: (root: Element) => boolean) => scope.some(fn)

          if (kind === 'file') {
            return any((root) =>
              [...root.querySelectorAll('input[type="file"]')].some((i) => ((i as HTMLInputElement).files?.length ?? 0) > 0) ||
              /\.(pdf|docx?)\b/i.test(root.textContent ?? ''),
            ) || own.some((i) => ((i as HTMLInputElement).files?.length ?? 0) > 0)
          }
          if (kind === 'radio' || kind === 'checkbox' || kind === 'checkboxes') {
            return own.some((i) => (i as HTMLInputElement).checked) || any((root) => Boolean(root.querySelector('input:checked')))
          }
          if (kind === 'buttons') {
            return any((root) =>
              Boolean(
                root.querySelector('input[type="checkbox"]:checked, button[aria-pressed="true"], button[class*="active" i], button[class*="selected" i]'),
              ),
            )
          }
          if (kind === 'combobox') {
            return any((root) =>
              Boolean(root.querySelector('[class*="single-value"], [class*="singleValue"], [class*="multi-value"], [class*="multiValue"]')) ||
              [...root.querySelectorAll('input')].some((i) => (i as HTMLInputElement).value.trim() !== ''),
            )
          }
          return any((root) =>
            [...(root.matches('input, textarea, select') ? [root] : root.querySelectorAll('input, textarea, select'))].some(
              (i) => ((i as HTMLInputElement).value ?? '').trim() !== '',
            ),
          )
        },
        { id: f.id, kind: f.kind },
      )
      .catch(() => false)
    if (!filled) missing.push(f.label)
  }
  return missing
}

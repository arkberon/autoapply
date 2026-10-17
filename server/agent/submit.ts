import type { Locator, Page } from 'playwright-core'

// Presses the form's submit button once and works out what happened. The agent
// never presses it twice: anything other than a clear confirmation is reported
// back, and the caller marks the job so it is not retried automatically.

export interface SubmitResult {
  outcome: 'applied' | 'parked' | 'uncertain'
  reasons: string[]
  /** The confirmation text the employer showed, for the receipt. */
  confirmation: string | null
}

// "Submit application" first; a bare "Apply" only when nothing says submit,
// because many pages also have an "Apply" button that just scrolls to the form.
const SUBMIT_NAMES = [
  /^\s*(submit( your)? application|submit|send application|finish application)\s*$/i,
  /^\s*(apply|apply now)\s*$/i,
]

const SUCCESS =
  /thank you for (applying|your application|submitting)|thanks for (applying|your application)|application (was |has been )?(successfully )?(submitted|received|sent)|we('ve| have) received your application|successfully (submitted|applied)|your application is (in|complete)/gi

const CODE_PROMPT = /verification code|security code|enter the code|confirmation code|code (we|that we) (sent|emailed)/i

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function bodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ')
}

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

export async function findSubmitButton(page: Page): Promise<Locator | null> {
  for (const name of SUBMIT_NAMES) {
    const byRole = page.getByRole('button', { name })
    for (let i = (await byRole.count()) - 1; i >= 0; i--) {
      const b = byRole.nth(i)
      if (await b.isVisible().catch(() => false)) return b
    }
    const inputs = page.locator('input[type="submit"]')
    for (let i = (await inputs.count()) - 1; i >= 0; i--) {
      const input = inputs.nth(i)
      if ((await input.isVisible().catch(() => false)) && name.test((await input.getAttribute('value')) ?? '')) return input
    }
  }
  return null
}

/** A CAPTCHA puzzle that needs a person: a visible, sizable challenge frame. */
async function challengeShowing(page: Page): Promise<boolean> {
  return page
    .locator('iframe[src*="hcaptcha"], iframe[src*="recaptcha"][src*="bframe"], iframe[title*="challenge" i]')
    .evaluateAll((frames) =>
      frames.some((f) => {
        const r = f.getBoundingClientRect()
        const style = getComputedStyle(f)
        return r.width > 150 && r.height > 150 && style.visibility !== 'hidden' && style.display !== 'none'
      }),
    )
    .catch(() => false)
}

async function visibleErrors(page: Page): Promise<string[]> {
  return page
    .locator('[role="alert"], .error-message, .error, [class*="errorMessage" i], [class*="error-text" i], [class*="field-error" i]')
    .evaluateAll((els) =>
      els
        .filter((e) => {
          const r = (e as HTMLElement).getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
        .map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length < 200),
    )
    .catch(() => [])
}

export async function submitAndConfirm(page: Page, timeoutMs = 45_000): Promise<SubmitResult> {
  const button = await findSubmitButton(page)
  if (!button) return { outcome: 'parked', reasons: ['Could not find the submit button'], confirmation: null }

  // Job descriptions sometimes say "thank you for applying" already; only new wording counts.
  const before = await bodyText(page)
  const startUrl = page.url()
  await button.click({ timeout: 10_000 })

  const deadline = Date.now() + timeoutMs
  let errorsSeenAt = 0
  while (Date.now() < deadline) {
    await pause(1000)
    const text = await bodyText(page)
    const url = page.url()

    const newSuccess = count(text, SUCCESS) > count(before, SUCCESS)
    // Pages that swap the whole form for a thank-you message: the wording is there and the form is gone.
    const formGone = count(text, SUCCESS) > 0 && !(await findSubmitButton(page))
    const confirmationUrl = url !== startUrl && /confirm|thank|submitted|success|complete/i.test(url)
    if (newSuccess || formGone || confirmationUrl) {
      const match = text.match(new RegExp(SUCCESS.source, 'i'))
      const at = match ? Math.max(0, text.indexOf(match[0]) - 60) : 0
      return { outcome: 'applied', reasons: [], confirmation: text.slice(at, at + 300).trim() || url }
    }

    if (await challengeShowing(page)) {
      return { outcome: 'parked', reasons: ['A human check (CAPTCHA) appeared when submitting, so nothing was sent'], confirmation: null }
    }

    if (CODE_PROMPT.test(text) && !CODE_PROMPT.test(before)) {
      return {
        outcome: 'parked',
        reasons: ['The employer emailed you a verification code to finish this application'],
        confirmation: null,
      }
    }

    // Give the page a few seconds before reading its error messages as final.
    const errors = (await visibleErrors(page)).filter((e) => !before.includes(e))
    if (errors.length) {
      errorsSeenAt ||= Date.now()
      if (Date.now() - errorsSeenAt > 3000) {
        return { outcome: 'parked', reasons: errors.slice(0, 5).map((e) => `The form said: ${e}`), confirmation: null }
      }
    }
  }
  return {
    outcome: 'uncertain',
    reasons: ['Submit was pressed but no confirmation appeared. Check your email or the employer site before trying again.'],
    confirmation: null,
  }
}

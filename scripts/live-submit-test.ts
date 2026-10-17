// Checks the live submit step against fake application pages served from this
// machine, so nothing reaches a real employer. Each page reacts to submit the
// way real forms do: a thank-you message, a redirect, a CAPTCHA, a form error,
// an emailed code, or nothing at all.
//
// Run: npm run test:submit   (results print to the console; the page server
// stays up afterwards so the runner that started it can read the output)

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { runJob } from '../server/agent/run.ts'
import type { Job } from '../shared/types.ts'

const PORT = Number(process.env.PORT ?? 4320)
const BASE = `http://localhost:${PORT}`

const FORM = `<!doctype html><html><body>
<h1>Junior Software Engineer at Example Co</h1>
<p>About us: thank you for applying to roles at our company in the past.</p>
<form id="f">
  <div class="field"><label for="fn">First Name*</label><input id="fn" required></div>
  <div class="field"><label for="ln">Last Name*</label><input id="ln" required></div>
  <div class="field"><label for="em">Email*</label><input id="em" type="email" required></div>
  <div class="field"><label for="ph">Phone</label><input id="ph" type="tel"></div>
  <div class="field"><label for="rs">Resume*</label><input id="rs" type="file" required></div>
  <fieldset><legend>Are you legally authorized to work in the United States?*</legend>
    <label><input type="radio" name="auth" value="Yes" required>Yes</label>
    <label><input type="radio" name="auth" value="No">No</label>
  </fieldset>
  <button type="submit">Submit application</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', (e) => {
    e.preventDefault()
    fetch('/submitted?page=' + location.pathname)
    ACTION
  })
</script></body></html>`

const ACTIONS: Record<string, { action: string; expect: string }> = {
  success: { action: "document.body.innerHTML = '<h2>Thank you for applying!</h2><p>We will be in touch.</p>'", expect: 'applied' },
  redirect: { action: "location.href = '/thanks.html?confirmation=1'", expect: 'applied' },
  captcha: {
    action: "const f = document.createElement('iframe'); f.src = 'data:text/html,hcaptcha challenge'; f.width = 400; f.height = 500; document.body.appendChild(f)",
    expect: 'parked',
  },
  error: {
    action: "const d = document.createElement('div'); d.className = 'error-message'; d.textContent = 'Phone number is required'; document.getElementById('f').appendChild(d)",
    expect: 'parked',
  },
  code: {
    action: "const d = document.createElement('div'); d.innerHTML = '<p>Enter the verification code we sent to your email</p><input id=code>'; document.body.appendChild(d)",
    expect: 'parked',
  },
  silent: { action: '', expect: 'uncertain' },
}

const submits: Record<string, number> = {}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', BASE)
  if (url.pathname === '/submitted') {
    const page = path.basename(url.searchParams.get('page') ?? '', '.html')
    submits[page] = (submits[page] ?? 0) + 1
    res.end('ok')
    return
  }
  if (url.pathname === '/thanks.html') {
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><html><body><h2>Application received</h2><p>Your application has been submitted.</p></body></html>')
    return
  }
  const name = path.basename(url.pathname, '.html')
  const fixture = ACTIONS[name]
  if (!fixture) {
    res.statusCode = 404
    res.end('not found')
    return
  }
  res.setHeader('content-type', 'text/html')
  res.end(FORM.replace('ACTION', fixture.action))
})

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Fake application pages at ${BASE}`)
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-submit-test-'))
  const resume = path.join(work, 'resume.pdf')
  fs.writeFileSync(resume, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
  // A made-up applicant; the real saved answers are not used.
  const answers = { first_name: 'Sam', last_name: 'Sample', email: 'sam@example.com', phone: '(555) 010-0000', work_authorized: 'Yes' }

  const context = await chromium.launchPersistentContext(path.join(work, 'profile'), { channel: 'chrome', headless: true })
  await context.addInitScript('globalThis.__name = (fn) => fn')
  let failures = 0

  const run = async (name: string, mode: 'live' | 'dry') => {
    const job = { id: `zz_test_${name}_${mode}`, company: 'Example Co', role: 'Junior SWE', ats: 'Greenhouse', url: `${BASE}/${name}.html` } as Job
    let claims = 0
    const before = submits[name] ?? 0
    const result = await runJob(
      context,
      job,
      { id: job.id, company: job.company, role: job.role, location: 'NYC', answers, drafts: [], resumePath: resume },
      { mode, beforeSubmit: () => (claims++, true), confirmTimeoutMs: 8000 },
    )
    fs.rmSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data', 'applications', job.id), { recursive: true, force: true })
    return { result, claims, sent: (submits[name] ?? 0) - before }
  }

  for (const [name, { expect }] of Object.entries(ACTIONS)) {
    const { result, claims, sent } = await run(name, 'live')
    const ok = result.outcome === expect && sent === 1 && claims === 1
    if (!ok) failures++
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(8)} → ${result.outcome.padEnd(9)} (expected ${expect}) submitted ${sent}× ` +
        `${result.reasons.join(' | ').slice(0, 100)}${result.confirmation ? ` confirmation: "${result.confirmation.slice(0, 50)}"` : ''}`,
    )
  }

  const dry = await run('success', 'dry')
  const dryOk = dry.sent === 0 && dry.claims === 0 && dry.result.outcome === 'ready'
  if (!dryOk) failures++
  console.log(`${dryOk ? 'PASS' : 'FAIL'}  dry run  → ${dry.result.outcome} (expected ready) submitted ${dry.sent}×`)

  await context.close()
  fs.rmSync(work, { recursive: true, force: true })
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
})

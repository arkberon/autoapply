// Records a short demo video of the app for posting online.
//
// It runs a separate copy of the app on a demo database: the job list, companies
// and numbers are the real ones, but every personal answer (name, email, phone,
// address, links, resume file name) is replaced with a made-up person, so
// nothing private appears on screen. A browser then tours the app with captions
// and the recording is saved next to the project as auto-apply-demo.mp4.
//
// Run: npm run demo:video   (the real app and its data are not touched)

import Database from 'better-sqlite3'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Page } from 'playwright-core'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REAL_DB = path.join(APP_DIR, 'data', 'app.db')
const DEMO_DIR = path.join(APP_DIR, 'data', 'demo')
const OUTPUT_BASE = path.resolve(APP_DIR, '..', 'auto-apply-demo')
const PORT = Number(process.env.DEMO_PORT ?? 4331)
const BASE = `http://localhost:${PORT}`

// The made-up applicant shown in the video.
const PERSONA: Record<string, string> = {
  first_name: 'Sam',
  last_name: 'Rivera',
  preferred_name: '',
  middle_name: '',
  email: 'sam.rivera@example.com',
  phone: '(555) 010-0142',
  address_line1: '100 Example Street',
  address_line2: '',
  zip: '10001',
  county: '',
  linkedin: 'https://linkedin.com/in/sam-rivera-example',
  github: 'https://github.com/example',
  portfolio: 'https://example.com',
  city: 'New York',
  state: 'NY',
  school: 'State University',
  degree: 'Bachelor of Science',
  major: 'Computer Science',
  graduation: 'May 2026',
  current_employer: 'Example Labs',
  desired_salary: '85000',
  gender: 'Prefer not to say',
  race: 'Prefer not to say',
  hispanic_latino: 'Prefer not to say',
  veteran_status: 'Prefer not to say',
  disability_status: 'Prefer not to say',
  about_me: 'New-grad software engineer who likes building practical tools end to end.',
  proud_project: 'Built a small app that automates a tedious personal workflow, from data import to UI.',
  why_looking: 'Looking for my first full-time engineering role on a team that ships often.',
}

// Text the local model wrote from the real resume is replaced wholesale, since it can't be swapped word by word.
const DEMO_WRITTEN = 'I enjoy building reliable software end to end and would bring that care to this team.'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Copies the real database and replaces every personal answer with the persona. */
async function prepareDemoData() {
  fs.rmSync(DEMO_DIR, { recursive: true, force: true })
  fs.mkdirSync(DEMO_DIR, { recursive: true })
  const real = new Database(REAL_DB, { readonly: true })
  await real.backup(path.join(DEMO_DIR, 'app.db'))
  real.close()

  const db = new Database(path.join(DEMO_DIR, 'app.db'))
  const answers = Object.fromEntries(
    (db.prepare('SELECT key, value FROM answers').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]),
  )
  const resumePdf = (db.prepare("SELECT value FROM settings WHERE key = 'resume_pdf'").get() as { value: string } | undefined)?.value ?? ''

  // Every real value that could show up in text, mapped to its stand-in.
  const swaps: [string, string][] = []
  const add = (real: string | undefined, fake: string) => {
    if (real && real.trim().length >= 3) swaps.push([real.trim(), fake])
  }
  add(answers.first_name && answers.last_name ? `${answers.first_name} ${answers.last_name}` : '', 'Sam Rivera')
  for (const key of Object.keys(PERSONA)) add(answers[key], PERSONA[key] || '—')
  if (resumePdf) add(path.basename(resumePdf), 'Sam_Rivera_Resume.pdf')
  if (answers.first_name) add(answers.first_name, 'Sam')
  if (answers.last_name) add(answers.last_name, 'Rivera')
  const scrub = (text: string) => swaps.reduce((t, [from, to]) => t.split(from).join(to), text)
  const scrubRunAnswers = (json: string) => {
    try {
      // Answers are lists of values; keep that shape so the Activity view can show them.
      const list = JSON.parse(json) as { answer?: string[]; source?: string | null }[]
      return JSON.stringify(list.map((a) => (a.source === 'model' && a.answer?.length ? { ...a, answer: [DEMO_WRITTEN] } : a)))
    } catch {
      return json
    }
  }

  db.transaction(() => {
    for (const [key, value] of Object.entries(PERSONA)) {
      db.prepare("INSERT INTO answers (key, value, source, updated_at) VALUES (?, ?, 'you', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value)
    }
    for (const table of [
      { name: 'runs', cols: ['answers', 'reasons'] },
      { name: 'drafts', cols: ['value'] },
      { name: 'jobs', cols: ['notes', 'raw'] },
    ]) {
      const rows = db.prepare(`SELECT rowid AS id, ${table.cols.join(', ')} FROM ${table.name}`).all() as Record<string, string>[]
      const update = db.prepare(`UPDATE ${table.name} SET ${table.cols.map((c) => `${c} = ?`).join(', ')} WHERE rowid = ?`)
      for (const row of rows) {
        update.run(...table.cols.map((c) => scrub(table.name === 'runs' && c === 'answers' ? scrubRunAnswers(row[c] ?? '[]') : row[c] ?? '')), row.id)
      }
    }
    db.prepare('UPDATE drafts SET value = ? WHERE length(value) > 40').run(DEMO_WRITTEN)
    const events = db.prepare('SELECT id, detail FROM events').all() as { id: number; detail: string }[]
    for (const e of events) db.prepare('UPDATE events SET detail = ? WHERE id = ?').run(scrub(e.detail), e.id)
    // Point the resume at placeholder files and stop the demo server fetching the real Google Doc.
    fs.mkdirSync(path.join(DEMO_DIR, 'resume'), { recursive: true })
    for (const ext of ['pdf', 'docx']) {
      const file = path.join(DEMO_DIR, 'resume', `Sam_Rivera_Resume.${ext}`)
      fs.writeFileSync(file, '')
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(file, `resume_${ext}`)
    }
    db.prepare("UPDATE settings SET value = 'https://docs.google.com/document/d/example/edit' WHERE key = 'resume_doc_url'").run()
    db.prepare("UPDATE settings SET value = '' WHERE key = 'resume_error'").run()
    // The demo must never apply to anything.
    db.prepare("INSERT INTO settings (key, value) VALUES ('schedule_enabled', '0') ON CONFLICT(key) DO UPDATE SET value = '0'").run()
  })()

  const schedule = db.prepare("SELECT value FROM settings WHERE key = 'schedule_enabled'").get() as { value: string }
  if (schedule.value !== '0') throw new Error('Demo copy still has the daily schedule on; refusing to record')
  db.close()
}

function startDemoServer(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: APP_DIR,
    env: { ...process.env, PORT: String(PORT), AUTOAPPLY_DATA_DIR: DEMO_DIR, AUTOAPPLY_NO_RESUME_SYNC: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return new Promise((resolve, reject) => {
    child.stdout!.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk)
      if (chunk.toString().includes('is running at')) resolve(child)
    })
    child.on('exit', (code) => reject(new Error(`Demo server exited (${code})`)))
  })
}

// ── On-screen helpers: a caption bar and a visible cursor.

const OVERLAY = `
  (() => {
    const style = document.createElement('style');
    style.textContent = \`
      #demo-caption { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 9999;
        max-width: 900px; padding: 14px 24px; border-radius: 16px; background: rgba(10,12,16,0.92);
        border: 1px solid #2f3542; color: #ecedea; font: 600 20px/1.35 'IBM Plex Sans', system-ui, sans-serif;
        text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.5); transition: opacity .35s; }
      #demo-caption small { display: block; margin-top: 4px; color: #a9adb4; font-weight: 400; font-size: 15px; }
      #demo-cursor { position: fixed; z-index: 10000; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        background: rgba(143,176,255,0.35); border: 2px solid #8fb0ff; pointer-events: none; transition: transform .12s; }
      #demo-cursor.down { transform: scale(0.7); }
      #demo-end { position: fixed; inset: 0; z-index: 10001; display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 18px; background: #0f1114; color: #ecedea; font-family: 'Space Grotesk', system-ui, sans-serif; }
    \`;
    document.head.appendChild(style);
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor'; document.body.appendChild(cursor);
    addEventListener('mousemove', (e) => { cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => cursor.classList.add('down'), true);
    addEventListener('mouseup', () => cursor.classList.remove('down'), true);
  })();
`

async function caption(page: Page, title: string, detail = '') {
  await page.evaluate(
    ({ title, detail }) => {
      let el = document.getElementById('demo-caption')
      if (!el) {
        el = document.createElement('div')
        el.id = 'demo-caption'
        document.body.appendChild(el)
      }
      el.innerHTML = ''
      el.append(title)
      if (detail) {
        const small = document.createElement('small')
        small.textContent = detail
        el.append(small)
      }
    },
    { title, detail },
  )
}

async function moveTo(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 })
}

async function clickOn(page: Page, selector: string) {
  await moveTo(page, selector)
  await pause(250)
  await page.locator(selector).first().click()
}

async function smoothScroll(page: Page, to: number, ms = 1600) {
  await page.evaluate(
    ({ to, ms }) =>
      new Promise<void>((done) => {
        const from = scrollY
        const start = performance.now()
        const step = (t: number) => {
          const k = Math.min(1, (t - start) / ms)
          scrollTo(0, from + (to - from) * (1 - Math.pow(1 - k, 3)))
          if (k < 1) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      }),
    { to, ms },
  )
}

async function tour(page: Page) {
  const go = async (tab: string) => {
    await clickOn(page, `nav >> text="${tab}"`)
    await pause(900)
  }

  // Dashboard
  await page.goto(`${BASE}/#home`)
  await page.waitForSelector('.status-band')
  await page.addScriptTag({ content: OVERLAY })
  await page.mouse.move(640, 360)
  await caption(page, 'Auto Apply: your job hunt on autopilot', 'Open source · runs on your Mac with a local AI model')
  await pause(4500)
  await caption(page, 'One dashboard for the whole search', 'Today’s progress, your pipeline, and what the agent is doing right now')
  await smoothScroll(page, 520)
  await pause(3200)
  await caption(page, 'Every job ranked by fit, city and work area')
  await smoothScroll(page, 980)
  await pause(3000)
  await caption(page, 'It tells you exactly what needs you', 'And keeps the setup healthy: resume, local model, answers, posting checks')
  await smoothScroll(page, 2000)
  await pause(3200)
  await smoothScroll(page, 0, 1000)

  // Share card
  await caption(page, 'Share your progress as an image')
  await clickOn(page, '.band-actions >> text="Share"')
  await pause(3800)
  await page.keyboard.press('Escape')
  await pause(600)

  // Jobs: search report and filters
  await go('Jobs')
  await caption(page, 'Find new jobs on company boards and public new-grad lists', 'Every search explains its result: checked, new, already listed, other cities, too old')
  await moveTo(page, '.card.find')
  await pause(4800)
  await caption(page, 'Filter by city and work area')
  await moveTo(page, 'select[aria-label="City"]')
  await page.selectOption('select[aria-label="City"]', 'San Diego')
  await pause(2200)
  await moveTo(page, 'select[aria-label="Work area"]')
  await page.selectOption('select[aria-label="Work area"]', 'Software engineering')
  await pause(2200)
  await caption(page, 'See when it was posted, why it’s ranked and how it applies')
  await clickOn(page, 'tbody tr:first-child td:nth-child(2)')
  await pause(4200)
  await page.selectOption('select[aria-label="City"]', '')
  await page.selectOption('select[aria-label="Work area"]', '')
  await pause(500)

  // Clean up preview (nothing is removed)
  await caption(page, 'Clean up stale postings in one click', 'It previews everything first; nothing is removed until you confirm')
  await clickOn(page, '.cleanup-toggle')
  await pause(800)
  await clickOn(page, '.cleanup label.check:has-text("older than 2 months") input')
  await pause(3800)
  await clickOn(page, '.cleanup label.check:has-text("older than 2 months") input')
  await clickOn(page, '.cleanup-toggle')
  await pause(500)

  // Links
  await go('Links')
  await caption(page, 'Follow career pages and see only what’s new')
  await pause(3200)

  // Activity
  await go('Activity')
  await caption(page, 'A daily schedule: find, check, apply', 'With a receipt for every application and a notification when it’s done')
  await pause(4500)
  await caption(page, 'Every answer, and where it came from', 'Saved answers first. Legal questions are never guessed. Anything unsafe waits for you')
  await smoothScroll(page, 560)
  await clickOn(page, '.run details summary')
  await pause(5200)

  // End card
  await page.evaluate(() => {
    document.getElementById('demo-caption')?.remove()
    const end = document.createElement('div')
    end.id = 'demo-end'
    end.innerHTML =
      '<div style="display:flex;align-items:center;gap:16px;font-size:56px;font-weight:700"><svg width="64" height="64" viewBox="0 0 28 28"><rect width="28" height="28" rx="8" fill="#2A2E35"></rect><path d="M8 15.5l4 4 8-10" fill="none" stroke="#8FB0FF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>Auto Apply</div>' +
      '<div style="font-size:30px;color:#c9ccd1;font-weight:500">Your job hunt, minus the copy-paste.</div>' +
      '<div style="font:500 24px IBM Plex Mono, monospace;color:#8fb0ff">github.com/arkberon/autoapply</div>'
    document.body.appendChild(end)
  })
}

await prepareDemoData()
const demo = await startDemoServer()
// Never leave the demo server running, however this script ends.
const stopDemo = () => demo.kill()
process.on('exit', stopDemo)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => process.exit(1))

// ── Recording without extra tools: Chrome streams frames of the page while the
// tour runs, then its built-in MediaRecorder replays them at their original
// timing into an MP4 (WebM when MP4 is not available).

interface Frame {
  jpeg: Buffer
  at: number
}

async function encode(context: BrowserContext, frames: Frame[], size: { width: number; height: number }): Promise<{ file: string; type: string }> {
  const page = await context.newPage()
  // Frames are served to the encoding page one by one; the finished video comes back the same way.
  let video: Buffer | null = null
  await page.route('http://encoder.local/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas>' })
    if (url.pathname.startsWith('/frame/')) {
      return route.fulfill({ contentType: 'image/jpeg', body: frames[Number(url.pathname.split('/')[2])].jpeg })
    }
    if (url.pathname === '/upload') {
      video = route.request().postDataBuffer()
      return route.fulfill({ body: 'ok' })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://encoder.local/')
  const offsets = frames.map((f) => f.at - frames[0].at)
  const type: string = await page.evaluate(
    async ({ offsets, size }) => {
      const canvas = document.querySelector('canvas')!
      canvas.width = size.width
      canvas.height = size.height
      const ctx = canvas.getContext('2d')!
      const types = ['video/mp4;codecs=avc1.4D401F', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
      const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
      const stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 })
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      const load = (i: number) =>
        new Promise<HTMLImageElement>((done) => {
          const img = new Image()
          img.onload = () => done(img)
          img.src = `/frame/${i}`
        })
      let next = await load(0)
      ctx.drawImage(next, 0, 0, size.width, size.height)
      recorder.start(1000)
      const start = performance.now()
      for (let i = 0; i < offsets.length; i++) {
        const following = i + 1 < offsets.length ? load(i + 1) : null
        const wait = offsets[i] * 1000 - (performance.now() - start)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        ctx.drawImage(next, 0, 0, size.width, size.height)
        if (following) next = await following
      }
      await new Promise((r) => setTimeout(r, 1500))
      await new Promise<void>((done) => {
        recorder.onstop = () => done()
        recorder.stop()
      })
      const blob = new Blob(chunks, { type: mimeType })
      await fetch('/upload', { method: 'POST', body: blob })
      return mimeType
    },
    { offsets, size },
  )
  await page.close()
  if (!video) throw new Error('The encoder returned no video')
  const ext = type.includes('mp4') ? 'mp4' : 'webm'
  const file = `${OUTPUT_BASE}.${ext}`
  fs.writeFileSync(file, video)
  return { file, type }
}

const SIZE = { width: 1280, height: 800 }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: SIZE, colorScheme: 'dark' })
await context.addInitScript('globalThis.__name = (fn) => fn')
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
const frames: Frame[] = []
cdp.on('Page.screencastFrame', (event: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
  frames.push({ jpeg: Buffer.from(event.data, 'base64'), at: event.metadata.timestamp ?? Date.now() / 1000 })
  void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => undefined)
})
try {
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 })
  await tour(page)
  // The closing card is static, and the stream only sends frames when something changes, so capture it directly and hold it.
  const endCard = await page.screenshot({ type: 'jpeg', quality: 90 })
  frames.push({ jpeg: endCard, at: Date.now() / 1000 })
  await pause(4500)
  frames.push({ jpeg: endCard, at: Date.now() / 1000 })
  await cdp.send('Page.stopScreencast')
  frames.sort((a, b) => a.at - b.at)
  console.log(`Captured ${frames.length} frames over ${Math.round(frames[frames.length - 1].at - frames[0].at)} s; encoding…`)
  const { file, type } = await encode(context, frames, SIZE)
  console.log(`Demo video saved: ${file} (${type}, ${Math.round(fs.statSync(file).size / 1024 / 1024 * 10) / 10} MB)`)
} finally {
  await browser.close()
  demo.kill()
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, getSetting, logEvent, now, setSetting } from './db.ts'
import type { ResumeInfo } from '../shared/types.ts'

const RESUME_DIR = path.join(DATA_DIR, 'resume')

/** Only the document id is ever sent to Google; account ids in a pasted share link are dropped. */
export function docIdFromUrl(url: string): string | null {
  return url.match(/\/d\/([A-Za-z0-9_-]{20,})/)?.[1] ?? null
}

function fileNameFrom(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition') ?? ''
  const name = header.match(/filename="([^"]+)"/)?.[1] ?? fallback
  // Google names the PDF of an uploaded Word file "name.docx.pdf".
  return name.replace(/[^\w.\- ]/g, '_').replace(/\.docx\.pdf$/i, '.pdf')
}

async function download(docId: string, format: 'pdf' | 'docx'): Promise<{ name: string; bytes: Buffer }> {
  const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=${format}`, {
    signal: AbortSignal.timeout(30_000),
  })
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || type.includes('text/html')) {
    // Google answers with a sign-in page when the document is not shared by link.
    throw new Error('Google would not export the document. Set sharing to "Anyone with the link can view".')
  }
  return { name: fileNameFrom(res, `resume.${format}`), bytes: Buffer.from(await res.arrayBuffer()) }
}

export function resumeInfo(): ResumeInfo {
  const pdf = getSetting('resume_pdf')
  const docx = getSetting('resume_docx')
  return {
    docUrl: getSetting('resume_doc_url'),
    pdf: pdf && fs.existsSync(pdf) ? pdf : null,
    docx: docx && fs.existsSync(docx) ? docx : null,
    sha256: getSetting('resume_sha256') || null,
    syncedAt: getSetting('resume_synced_at') || null,
    changedAt: getSetting('resume_changed_at') || null,
    error: getSetting('resume_error') || null,
  }
}

/**
 * Pulls the latest resume from the Google Doc. Runs on start, on demand, and
 * before each application run, so the uploaded file always matches the document.
 * A failed sync keeps the last good copy.
 */
export async function syncResume(): Promise<ResumeInfo> {
  const docId = docIdFromUrl(getSetting('resume_doc_url'))
  if (!docId) {
    setSetting('resume_error', 'Paste your Google Docs resume link in Settings.')
    return resumeInfo()
  }

  try {
    const [pdf, docx] = await Promise.all([download(docId, 'pdf'), download(docId, 'docx')])
    fs.mkdirSync(RESUME_DIR, { recursive: true })
    for (const old of fs.readdirSync(RESUME_DIR)) fs.rmSync(path.join(RESUME_DIR, old))

    const pdfPath = path.join(RESUME_DIR, pdf.name)
    const docxPath = path.join(RESUME_DIR, docx.name)
    fs.writeFileSync(pdfPath, pdf.bytes)
    fs.writeFileSync(docxPath, docx.bytes)

    const sha = crypto.createHash('sha256').update(docx.bytes).digest('hex')
    if (sha !== getSetting('resume_sha256')) {
      setSetting('resume_changed_at', now())
      logEvent(null, 'resume_changed', pdf.name)
    }
    setSetting('resume_pdf', pdfPath)
    setSetting('resume_docx', docxPath)
    setSetting('resume_sha256', sha)
    setSetting('resume_synced_at', now())
    setSetting('resume_error', '')
  } catch (err) {
    setSetting('resume_error', err instanceof Error ? err.message : String(err))
  }
  return resumeInfo()
}

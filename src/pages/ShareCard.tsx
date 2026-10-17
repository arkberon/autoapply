import { useEffect, useRef, useState } from 'react'

// A 1080×1350 image for social posts, drawn on a canvas so it can be saved as a PNG.

interface Props {
  applied: number
  ranked: number
  found: number
  onClose: () => void
}

const ACCENTS = ['#8FB0FF', '#7BE0B4', '#FFC46B', '#F0A6CA']
const W = 1080
const H = 1350
const PAD = 88

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

function draw(canvas: HTMLCanvasElement, { applied, ranked, found, accent, period }: { applied: number; ranked: number; found: number; accent: string; period: string }) {
  const ctx = canvas.getContext('2d')!
  const display = "'Space Grotesk', 'IBM Plex Sans', sans-serif"
  const body = "'IBM Plex Sans', system-ui, sans-serif"
  const mono = "'IBM Plex Mono', monospace"
  const ink = '#ECEDEA'
  const muted = '#B4B8BE'

  ctx.fillStyle = '#0F1114'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  // Logo and name
  ctx.fillStyle = '#2A2E35'
  ctx.beginPath()
  ctx.roundRect(PAD, PAD, 56, 56, 16)
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 5.2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(PAD + 16, PAD + 31)
  ctx.lineTo(PAD + 24, PAD + 39)
  ctx.lineTo(PAD + 40, PAD + 19)
  ctx.stroke()
  ctx.fillStyle = ink
  ctx.font = `700 34px ${display}`
  ctx.fillText('Auto Apply', PAD + 76, PAD + 40)

  // Period pill
  ctx.font = `600 24px ${body}`
  const pw = ctx.measureText(period).width + 44
  ctx.strokeStyle = '#2F3542'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(W - PAD - pw, PAD + 4, pw, 48, 24)
  ctx.stroke()
  ctx.fillText(period, W - PAD - pw + 22, PAD + 36)

  // Headline and line under it
  ctx.font = `700 96px ${display}`
  ctx.fillText('My job hunt', PAD, 390)
  ctx.fillText('runs itself now.', PAD, 486)
  ctx.fillStyle = muted
  ctx.font = `400 32px ${body}`
  wrap(ctx, 'I answered the same questions once. An agent on my laptop finds the openings, fills the forms and tells me what it sent.', 860).forEach(
    (line, i) => ctx.fillText(line, PAD, 566 + i * 46),
  )

  // Big number
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.roundRect(PAD, 740, W - PAD * 2, 210, 28)
  ctx.fill()
  ctx.fillStyle = '#0B1A4A'
  ctx.font = `700 150px ${display}`
  ctx.fillText(String(applied), PAD + 40, 900)
  const nw = ctx.measureText(String(applied)).width
  ctx.font = `600 34px ${body}`
  ctx.fillText('applications sent', PAD + 40 + nw + 28, 900)

  // Two smaller numbers
  const half = (W - PAD * 2 - 20) / 2
  ;[
    { n: ranked, label: 'jobs ranked by fit' },
    { n: found, label: 'openings it found for me' },
  ].forEach((item, i) => {
    const x = PAD + i * (half + 20)
    ctx.fillStyle = '#1A1E25'
    ctx.beginPath()
    ctx.roundRect(x, 970, half, 170, 28)
    ctx.fill()
    ctx.fillStyle = ink
    ctx.font = `700 80px ${display}`
    ctx.fillText(String(item.n), x + 36, 1060)
    ctx.fillStyle = muted
    ctx.font = `400 26px ${body}`
    ctx.fillText(item.label, x + 36, 1108)
  })

  // Footer
  ctx.strokeStyle = '#2F3542'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, 1194)
  ctx.lineTo(W - PAD, 1194)
  ctx.stroke()
  ctx.fillStyle = muted
  ctx.font = `400 24px ${body}`
  ctx.fillText('Runs on my Mac · local AI · no data shared', PAD, 1252)
  ctx.fillStyle = ink
  ctx.font = `500 24px ${mono}`
  const url = 'github.com/arkberon/autoapply'
  ctx.fillText(url, W - PAD - ctx.measureText(url).width, 1252)
}

export function ShareCard({ applied, ranked, found, onClose }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [accent, setAccent] = useState(ACCENTS[0])
  const [count, setCount] = useState(applied)
  const period = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  useEffect(() => {
    let cancelled = false
    // Draw once the web fonts are in, so the image uses them.
    document.fonts.ready.then(() => {
      if (!cancelled && canvas.current) draw(canvas.current, { applied: count, ranked, found, accent, period })
    })
    return () => {
      cancelled = true
    }
  }, [accent, count, ranked, found, period])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const download = () => {
    canvas.current?.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'auto-apply.png'
      a.click()
      URL.revokeObjectURL(a.href)
    }, 'image/png')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-h" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2 id="share-h">Share your progress</h2>
          <button className="link-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="share-body">
          <canvas ref={canvas} width={W} height={H} className="share-canvas" aria-label="Share card preview" />
          <div className="share-controls">
            <label htmlFor="share-count">Applications to show</label>
            <input
              id="share-count"
              type="text"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(Number(e.target.value.replace(/\D/g, '')) || 0)}
            />
            <p className="help">
              Your total applied ({applied}) includes ones you sent yourself. Lower it to count only what the agent sent.
            </p>
            <span className="label">Accent</span>
            <div className="swatches">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  className={a === accent ? 'swatch active' : 'swatch'}
                  style={{ background: a }}
                  aria-label={`Accent ${a}`}
                  aria-pressed={a === accent}
                  onClick={() => setAccent(a)}
                />
              ))}
            </div>
            <button className="primary" onClick={download}>
              Download image
            </button>
            <p className="help">1080 × 1350 PNG, sized for Instagram, LinkedIn and X.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

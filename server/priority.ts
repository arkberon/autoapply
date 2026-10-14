import type { Priority } from '../shared/types.ts'

// Priority comes from two notes already in the job sheet: how well the resume
// fits the role, and how hard the role was estimated to be to land. Nothing is
// skipped: roles with an unconfirmed requirement simply sort last.

function fitScore(fit: string): { score: number; label: string; hold: boolean } {
  const f = fit.toLowerCase()
  if (/hold|eligibility check|lower priority|included at user request/.test(f)) {
    return { score: 0, label: 'a requirement is unconfirmed', hold: true }
  }
  if (f.startsWith('strong')) return { score: 3, label: 'strong fit', hold: false }
  if (f.startsWith('good')) return { score: 2.5, label: 'good fit', hold: false }
  if (f.startsWith('conditional')) return { score: 1, label: 'conditional fit', hold: false }
  if (f.startsWith('competitive')) return { score: 1.5, label: 'competitive role', hold: false }
  if (f.startsWith('alternative')) return { score: 1.5, label: 'alternative path', hold: false }
  if (f.startsWith('early-career')) return { score: 1.5, label: 'early-career role, requirements unverified', hold: false }
  if (f.startsWith('possible')) return { score: 1.5, label: 'possible fit', hold: false }
  return { score: 1.5, label: 'fit not rated', hold: false }
}

function difficultyScore(difficulty: string): { score: number; label: string } {
  const d = difficulty.toLowerCase().trim()
  if (/^(very high|extreme)/.test(d)) return { score: -2, label: 'very high difficulty' }
  if (/^(moderate[–-]high|moderate[–-]higher|conditional moderate)/.test(d)) {
    return { score: -0.5, label: 'moderate-to-high difficulty' }
  }
  if (/^(lower|low)[–-]moderate/.test(d)) return { score: 0.5, label: 'lower-to-moderate difficulty' }
  if (/^(lower|low)\b/.test(d)) return { score: 1, label: 'lower difficulty' }
  if (/^moderate/.test(d)) return { score: 0, label: 'moderate difficulty' }
  if (/^(high|higher|stretch)/.test(d)) return { score: -1, label: 'high difficulty' }
  return { score: 0, label: 'difficulty unknown' }
}

export function computePriority(fit: string, difficulty: string): { priority: Priority; reason: string; hold: boolean } {
  const f = fitScore(fit)
  const d = difficultyScore(difficulty)
  const reason = `${f.label[0].toUpperCase()}${f.label.slice(1)} · ${d.label}`
  if (f.hold) return { priority: 4, reason, hold: true }

  const total = f.score + d.score
  const priority: Priority = total >= 3 ? 1 : total >= 2 ? 2 : total >= 1 ? 3 : 4
  return { priority, reason, hold: false }
}

import { SURVEY_EPOCHS } from '../../data/fixtures/mine'
import { formatDate } from '../format'

const [BASELINE, CURRENT] = SURVEY_EPOCHS

/** Where the before/after slider is: on the baseline, on the current survey, or between them. */
export type Phase = 'baseline' | 'between' | 'current'

export const phaseOf = (t: number): Phase =>
  t <= 0.001 ? 'baseline' : t < 1 ? 'between' : 'current'

/**
 * The one sentence under the landing model. Only the two ends are surveys; in between the model is
 * a blend of them, and it says so. The overlays describe the current survey against the baseline,
 * so they show only when the slider is on Current, and the sentence says that when one is switched
 * on elsewhere.
 */
export function modelSentence(phase: Phase, change: boolean, findings: boolean): string {
  const date = (e: typeof BASELINE) => (e ? formatDate(e.date) : '')
  const what =
    phase === 'baseline'
      ? `Baseline survey, ${date(BASELINE)}`
      : phase === 'current'
        ? `Current survey, ${date(CURRENT)}`
        : 'An illustration between the two surveys, not a survey'
  if (!change && !findings) return `${what}.`
  if (phase !== 'current') return `${what}; the overlays show on the current survey.`
  const extra = {
    both: 'with the change in rust and blue and simulated permit findings ringed',
    change: 'with rust where rock was removed and blue where it was added',
    findings: 'with simulated permit findings ringed inside the lease line',
  }[change && findings ? 'both' : change ? 'change' : 'findings']
  return `${what}, ${extra}.`
}

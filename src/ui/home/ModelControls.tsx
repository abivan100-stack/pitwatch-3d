import type { ComponentType, SVGProps } from 'react'
import { SURVEY_EPOCHS } from '../../data/fixtures/mine'
import { STEP, moveView, resetView } from '../../state/homeView'
import { setStory, tweenStory, useStory } from '../../state/story'
import { formatDate } from '../format'
import { ChangeIcon, FindingIcon } from '../icons'
import { modelSentence, phaseOf } from './modelText'

const [BASELINE, CURRENT] = SURVEY_EPOCHS

/** What the slider's value reads as to a screen reader: the survey, or "illustration" in between. */
const valueText = (t: number) =>
  t <= 0.001
    ? `Baseline survey, ${BASELINE ? formatDate(BASELINE.date) : ''}`
    : t < 1
      ? 'Illustration between the two surveys'
      : `Current survey, ${CURRENT ? formatDate(CURRENT.date) : ''}`

/**
 * One before/after control: Baseline at the left, Current at the right. Dragging it, or its keys,
 * sets the model's position between the two surveys; the two labels glide it to either end.
 */
function BeforeAfter() {
  const t = useStory((s) => s.t)
  return (
    <div className="before-after">
      <button type="button" className="ba-end" onClick={() => tweenStory(0)}>
        <span className="ba-name">Baseline</span>
        <span className="ba-date">{BASELINE ? formatDate(BASELINE.date) : ''}</span>
      </button>
      <input
        type="range"
        className="noise-range ba-range"
        min={0}
        max={1}
        step={0.05}
        value={t}
        aria-label="Survey shown, from baseline to current"
        aria-valuetext={valueText(t)}
        onChange={(e) => setStory(Number(e.target.value))}
      />
      <button type="button" className="ba-end ba-end-right" onClick={() => tweenStory(1)}>
        <span className="ba-name">Current</span>
        <span className="ba-date">{CURRENT ? formatDate(CURRENT.date) : ''}</span>
      </button>
    </div>
  )
}

function Toggle({
  on,
  onChange,
  Icon,
  label,
}: {
  on: boolean
  onChange: (on: boolean) => void
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`model-toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    >
      <Icon className="h-[18px] w-[18px] shrink-0 max-sm:hidden" />
      <span className="flex-1 text-left">{label}</span>
      <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true" />
    </button>
  )
}

/** The before/after slider, the two overlay switches and the one sentence that says what is shown. */
export function ModelControls({
  change,
  findings,
  onChange,
  onFindings,
}: {
  change: boolean
  findings: boolean
  onChange: (on: boolean) => void
  onFindings: (on: boolean) => void
}) {
  const phase = useStory((s) => phaseOf(s.t))
  return (
    <div role="group" aria-label="What the model shows" className="hero-controls">
      <BeforeAfter />
      <div className="model-toggles">
        <Toggle on={change} onChange={onChange} Icon={ChangeIcon} label="Show change" />
        <Toggle
          on={findings}
          onChange={onFindings}
          Icon={FindingIcon}
          label="Show permit findings"
        />
      </div>
      <p role="status" className="model-status">
        {modelSentence(phase, change, findings)}
      </p>
    </div>
  )
}

const Arrow = ({ flip }: { flip?: boolean }) => (
  <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" aria-hidden="true" fill="none">
    <path
      d={flip ? 'M12 4 L6 10 L12 16' : 'M8 4 L14 10 L8 16'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

/** Rotate and reset buttons, so a touch screen does not depend on a sideways swipe to turn the model. */
export function TurnButtons() {
  return (
    <div role="group" aria-label="Turn the model" className="model-turn">
      <button
        type="button"
        className="model-btn"
        aria-label="Turn left"
        onClick={() => moveView({ azimuth: STEP.button })}
      >
        <Arrow flip />
      </button>
      <button
        type="button"
        className="model-btn"
        aria-label="Turn right"
        onClick={() => moveView({ azimuth: -STEP.button })}
      >
        <Arrow />
      </button>
      <button type="button" className="model-btn" aria-label="Reset view" onClick={resetView}>
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" aria-hidden="true" fill="none">
          <path
            d="M4.5 10a5.5 5.5 0 1 0 1.7-4M4 3.5V6.5H7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

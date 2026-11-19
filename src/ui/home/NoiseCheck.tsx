import { useId, useState } from 'react'
import { changeThreshold } from '../../compliance/change'
import { COMPLIANCE_CONFIG } from '../../compliance/config'
import { combinedSigma } from '../../compliance/uncertainty'

const PRESETS = [
  { label: 'Drone survey with ground control', s1: 0.05, s2: 0.05, change: 0.4 },
  { label: 'Global elevation model', s1: 4, s2: 4, change: 6 },
]

/** The number line always runs 0 to AXIS_MAX, so a marker moves only when its value does. */
const AXIS_MAX = 12
const TICKS = [0, 3, 6, 9, 12]
/** Slider steps in metres: coarse enough to drag, and the keyboard arrow moves by the same. */
const WOBBLE_STEP = 0.05
const CHANGE_STEP = 0.1

const m = (v: number, digits = v < 1 ? 2 : 1) => `${v.toFixed(digits)} m`

/** A boundary that lands on a slider step can differ from it by binary roundoff. */
function snapToSliderStep(boundary: number): number {
  const step = Number(boundary.toFixed(2))
  const roundoff = 2 * Number.EPSILON * Math.max(1, boundary)
  return Math.abs(boundary - step) <= roundoff ? step : boundary
}

/**
 * Two lines have to be cleared before a change is reported: the noise limit (k·σ) and the
 * smallest change worth reporting on top of it (minChangeM + k·σ, the engine's own threshold).
 * The depth rule R2 is a different test and is explained on its own.
 */
export function NoiseCheck() {
  const [s1, setS1] = useState(0.05)
  const [s2, setS2] = useState(0.05)
  const [change, setChange] = useState(0.4)
  const id = useId()

  const cfg = COMPLIANCE_CONFIG
  const sigma = combinedSigma(s1, s2)
  // Use the engine's threshold formula and account for exact slider steps.
  const reportableFrom = snapToSliderStep(changeThreshold(sigma, cfg))
  const noiseBand = snapToSliderStep(cfg.k * sigma)
  const size = Math.abs(change)
  const verdict = size <= noiseBand ? 'noise' : size <= reportableFrom ? 'between' : 'reportable'
  const boundaries = [noiseBand, reportableFrom]
  let digits = 2
  // Keep unequal values distinct when rounding would show the same number.
  while (
    boundaries.some(
      (boundary) => boundary !== size && boundary.toFixed(digits) === size.toFixed(digits),
    )
  ) {
    digits++
  }
  const compared = (value: number) => m(value, digits)
  const pct = (v: number) => Math.min(100, (v / AXIS_MAX) * 100)

  // Fixed rows, so a flag changes height never. Each flag spans its marker's x (see .noise-flag).
  const flags = [
    { key: 'limit', text: 'Reporting threshold', value: reportableFrom },
    { key: 'band', text: 'Noise limit', value: noiseBand },
    { key: 'change', text: 'Your change', value: size },
  ]

  return (
    <section aria-labelledby="noise-title" className="rule-section">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
        <div className="contents lg:flex lg:flex-col lg:gap-6" data-testid="noise-left">
          <div className="max-lg:order-1">
            <h2 id="noise-title" className="section-title">
              When is a change reportable?
            </h2>
            <p className="mt-3 max-w-[34rem] text-[15px] leading-7 text-ink-dim">
              A change is reported only if it is bigger than the surveys&rsquo; own wobble, and
              bigger than a minimum on top of that.
            </p>
          </div>

          <div className="max-lg:order-3" data-testid="noise-result">
            <figure
              className="noise-chart"
              role="img"
              aria-label={`Number line from 0 to ${AXIS_MAX} metres. Noise limit ${compared(noiseBand)}, reporting threshold ${compared(reportableFrom)}, your change ${compared(size)}.`}
            >
              <div className="noise-flags" aria-hidden="true">
                {flags.map((f, row) => (
                  <div key={f.key}>
                    <div
                      className="noise-leader"
                      style={{ left: `${pct(f.value)}%`, top: row * 28 + 24 }}
                    />
                    <div
                      className={`noise-flag ${f.key === 'change' && verdict === 'reportable' ? 'real' : ''}`}
                      style={{
                        left: `${pct(f.value)}%`,
                        translate: `-${pct(f.value)}% 0`,
                        top: row * 28,
                      }}
                    >
                      {f.text} <strong>{compared(f.value)}</strong>
                    </div>
                  </div>
                ))}
              </div>
              {/* The shaded band is what the surveys could produce by themselves, the dashed
                  rule is where reporting starts, the diamond is the change being tested. */}
              <div className="noise-line" aria-hidden="true">
                <div className="noise-band" style={{ width: `${pct(noiseBand)}%` }} />
                <div className="noise-limit" style={{ left: `${pct(reportableFrom)}%` }} />
                <div
                  className={`noise-marker ${verdict === 'reportable' ? 'real' : ''}`}
                  style={{ left: `${pct(size)}%` }}
                />
              </div>
              <div className="noise-ticks" aria-hidden="true">
                {TICKS.map((t) => (
                  <span key={t} style={{ left: `${(t / AXIS_MAX) * 100}%` }}>
                    {t} m
                  </span>
                ))}
              </div>
              <figcaption className="mt-3 text-[13px] leading-6 text-ink-dim">
                Shaded: what the two surveys could produce by themselves, the noise limit ({cfg.k}{' '}
                times their combined wobble, σ = {m(sigma)}). Dashed line: the smallest change that
                is reported, the noise limit plus a {cfg.minChangeM} m minimum. Diamond: your
                change.
              </figcaption>
            </figure>

            <div className="mt-5">
              {/* Announced only when the category changes: the figures below it can move on
                  every slider step without re-reading anything. */}
              <p
                role="status"
                className={`text-[15px] font-semibold leading-6 ${
                  verdict === 'reportable' ? 'text-violation' : 'text-ink'
                }`}
              >
                {verdict === 'noise' && 'Could be survey noise.'}
                {verdict === 'between' && 'Distinguishable from the noise, not reportable.'}
                {verdict === 'reportable' && 'Reportable under R1 and R3.'}
              </p>
              <p className="mt-1 text-[14px] leading-6 text-ink-dim">
                {verdict === 'noise' && (
                  <>
                    {compared(size)} is within the ±{compared(noiseBand)} noise limit, so no rule
                    reports it.
                  </>
                )}
                {verdict === 'between' && (
                  <>
                    {compared(size)} is larger than the ±{compared(noiseBand)} the surveys could
                    produce by themselves, but {size === reportableFrom ? 'at' : 'below'} the{' '}
                    {compared(reportableFrom)} reporting threshold.
                  </>
                )}
                {verdict === 'reportable' && (
                  <>
                    {compared(size)} clears the {compared(reportableFrom)} reporting threshold, so
                    the lease-boundary and dumping rules (R1 and R3) test it against the permit.
                  </>
                )}
              </p>
            </div>
          </div>

          <details className="noise-note max-lg:order-4">
            <summary>Does the depth rule use this?</summary>
            <p>
              No. The depth rule (R2) compares the ground with the approved pit floor and has no
              minimum-change allowance, so a breach a few centimetres deep is still a warning. It
              uses only the current survey&rsquo;s wobble ({cfg.k}σ2 = {m(cfg.k * s2)}).
            </p>
          </details>
        </div>

        <div
          className="noise max-lg:order-2 lg:flex lg:flex-col lg:justify-between"
          data-testid="noise-controls"
        >
          <div
            role="group"
            aria-label="Example surveys"
            className="noise-seg"
            data-testid="noise-presets"
          >
            {PRESETS.map((p) => {
              const active = s1 === p.s1 && s2 === p.s2
              return (
                <button
                  key={p.label}
                  type="button"
                  aria-pressed={active}
                  className="noise-seg-btn"
                  onClick={() => {
                    setS1(p.s1)
                    setS2(p.s2)
                    setChange(p.change)
                  }}
                >
                  <span className="font-semibold">{p.label}</span>
                  <span className="noise-seg-note">
                    Sets both surveys to {m(p.s1, 2)} wobble and the example change to{' '}
                    {m(p.change, 1)}.
                  </span>
                </button>
              )
            })}
          </div>

          <Slider
            id={`${id}-s1`}
            label="Baseline survey wobble (σ1)"
            hint="How much the survey itself can move a height. 0 to 5 m."
            value={s1}
            max={5}
            step={WOBBLE_STEP}
            onChange={setS1}
          />
          <Slider
            id={`${id}-s2`}
            label="Current survey wobble (σ2)"
            hint="How much the survey itself can move a height. 0 to 5 m."
            value={s2}
            max={5}
            step={WOBBLE_STEP}
            onChange={setS2}
          />
          <Slider
            id={`${id}-c`}
            label="Measured change in ground height"
            hint={`The height difference between the two surveys, in metres, 0 to ${AXIS_MAX} m. The presets set an example change.`}
            value={change}
            max={AXIS_MAX}
            step={CHANGE_STEP}
            onChange={setChange}
          />
        </div>
      </div>
    </section>
  )
}

function Slider({
  id,
  label,
  hint,
  value,
  max,
  step,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-[14px] font-medium text-ink">
          {label}
        </label>
        <span className="noise-value font-mono text-[13px] text-ink" aria-hidden="true">
          {m(value, 2)}
        </span>
      </div>
      <p id={`${id}-hint`} className="text-[13px] leading-5 text-ink-dim">
        {hint}
      </p>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        aria-describedby={`${id}-hint`}
        aria-valuetext={m(value, 2)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="noise-range w-full"
      />
    </div>
  )
}

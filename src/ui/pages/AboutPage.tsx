import type { Provenance } from '../../domain/types'
import { ROUTE_HREF } from '../route'
import { Page } from '../shell/AppShell'
import { ProvenanceTag } from '../ProvenanceTag'

const PIPELINE = [
  ['Survey twice', 'Two drone surveys of the same ground, each with its error (σ).'],
  ['Keep real change', 'Only change beyond the permit threshold counts.'],
  ['Test the permit', 'Changed cells are checked against the lease, floor and dump zones.'],
  ['Report findings', 'Connected cells become ranked findings you can open on the map.'],
] as const

const SOURCES: [string, number, string][] = [
  ['Satellite imagery', 1, 'Surface only, no depth.'],
  ['Global elevation models', 2, '30 m grid, metres of error.'],
  ['Drone, LiDAR or DGPS surveys', 3, 'Centimetre accuracy.'],
]

const PROVENANCE: [Provenance, string][] = [
  ['measured', 'Taken directly from a survey instrument.'],
  ['derived', 'Calculated in this app from other values.'],
  ['simulated', 'Synthetic value for this fictional mine.'],
  ['unverified', 'Not checked against a survey.'],
]

const SHORTCUTS: [string, string][] = [
  ['[', 'Map card on or off'],
  [']', 'Details panel on or off'],
  ['M', 'Inspect or Measure'],
  ['R', 'Reset the camera'],
  ['F', 'Full screen'],
  ['Esc', 'Clear selection'],
  ['Arrow keys', 'Switch panel tab'],
]

/** What is simulated, what each kind of data can show, and how to read this app's labels. */
export function AboutPage() {
  return (
    <Page>
      <section aria-labelledby="pipeline" className="rule-section">
        <h2 id="pipeline" className="section-title">
          How a result is made
        </h2>
        <ol className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          {PIPELINE.map(([title, text], i) => (
            <li key={title}>
              <span className="font-mono text-[13px] text-oxide">0{i + 1}</span>
              <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
              <p className="text-[14px] leading-6 text-ink-dim">
                {text}
                {i === 1 && (
                  <>
                    {' '}
                    <a href={ROUTE_HREF.rules} className="text-accent underline">
                      See Permit rules
                    </a>
                    .
                  </>
                )}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="fictional" className="rule-section mt-6">
        <h2 id="fictional" className="section-title">
          This mine is fictional
        </h2>
        <p className="mt-3 text-[15px] leading-7 text-ink-dim">
          The terrain, both surveys and every finding are synthetic and generated from a fixed seed.
          The aerial image is simulated too, painted from the synthetic surface. The ground around
          the surveyed area on the 3D model is decorative scenery outside the survey edge; findings,
          the Inspector, measurements and exports never use it. Findings are the demo engine's
          classifications: violation and warning are its labels, not a regulator's, and not a legal
          determination (see{' '}
          <a href={ROUTE_HREF.findings} className="text-accent underline">
            Findings
          </a>
          ).
        </p>
      </section>
      <div className="mt-6 grid gap-x-14 gap-y-6 xl:grid-cols-2">
        <section aria-labelledby="labels" className="rule-section">
          <h2 id="labels" className="section-title">
            Where each value comes from
          </h2>
          <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
            {PROVENANCE.map(([value, meaning]) => (
              <div key={value} className="py-1">
                <dt className="mb-0.5">
                  <ProvenanceTag value={value} />
                </dt>
                <dd className="text-[14px] text-ink-dim">{meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section aria-labelledby="sources" className="rule-section">
          <h2 id="sources" className="section-title">
            What each data source can show
          </h2>
          <ul className="mt-3">
            {SOURCES.map(([name, fit, text]) => (
              <li key={name} className="py-1">
                <h3 className="inline text-[14px] font-semibold text-ink">{name}</h3>
                <span className="text-[14px] text-ink-dim">
                  {' '}
                  · {fit} of 3 for benches. {text}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="keys" className="rule-section mt-6">
        <h2 id="keys" className="section-title">
          Keyboard shortcuts on the 3D map
        </h2>
        <dl className="mt-3 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
          {SHORTCUTS.map(([key, action]) => (
            <div key={key} className="flex items-baseline gap-4 py-1">
              <dt className="w-[80px] shrink-0">
                <kbd className="kbd">{key}</kbd>
              </dt>
              <dd className="text-[14px] text-ink-dim">{action}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Page>
  )
}

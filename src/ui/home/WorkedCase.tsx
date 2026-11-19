import { useMemo } from 'react'
import { COMPLIANCE_CONFIG } from '../../compliance/config'
import { workedCase, type WorkedCase as Case } from '../../compliance/workedCase'
import { SURVEY_EPOCHS } from '../../data/fixtures/mine'
import { useTerrain } from '../../state/terrain'
import { GLYPH, toneOf } from '../findings'
import { formatDate } from '../format'
import { ProvenanceTag } from '../ProvenanceTag'

/*
 * One finding, followed through the three checks the engine runs on every cell: two surveys,
 * the change between them, the permit. Every figure is read from the same surveys and engine
 * output the Findings page uses, so the two cannot drift apart. Simulated data throughout.
 */

const [BASELINE, CURRENT] = SURVEY_EPOCHS

const n = (v: number, digits = 0) =>
  v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const sign = (v: number, digits: number) => `${v < 0 ? '−' : '+'}${n(Math.abs(v), digits)}`

export function WorkedCase({ onShowOnModel }: { onShowOnModel: () => void }) {
  const ready = useTerrain((s) => s.status === 'ready')
  const surveys = useTerrain((s) => s.surveys)
  const limits = useTerrain((s) => s.limits)
  const change = useTerrain((s) => s.change)
  const findings = useTerrain((s) => s.findings)

  const c = useMemo(
    () =>
      ready && surveys.baseline && surveys.current && limits && change
        ? workedCase(surveys.baseline, surveys.current, limits, { change, findings })
        : null,
    [ready, surveys, limits, change, findings],
  )

  if (!c) {
    return (
      <p role="status" className="case-wait">
        {ready ? 'The engine reported no finding to follow in this scenario.' : 'Evaluating…'}
      </p>
    )
  }
  return <Steps c={c} onShowOnModel={onShowOnModel} />
}

function Steps({ c, onShowOnModel }: { c: Case; onShowOnModel: () => void }) {
  const { finding: f } = c
  const tone = toneOf(f)
  const Glyph = GLYPH[tone]
  const cfg = COMPLIANCE_CONFIG
  const outside = c.leaseSide === 'outside'
  const times = Math.abs(c.dh) / c.threshold

  return (
    <article className="case" aria-label={`Worked example: finding ${f.id}`}>
      <div className="case-top">
        <section aria-labelledby="case-1">
          <h3 id="case-1" className="case-step">
            <span aria-hidden="true">1</span> Survey the ground twice
          </h3>
          <p className="case-text">
            Two drone surveys map the same cell of the pit, {BASELINE && CURRENT ? '' : ''}
            at E {n(c.p.x)} m, N {n(c.p.y)} m. Each height carries the survey’s own error.
          </p>
          <dl className="case-heights">
            <div>
              <dt>Baseline, {BASELINE ? formatDate(BASELINE.date) : ''}</dt>
              <dd>
                {n(c.baselineRL, 2)} m RL <b>±{n(c.baselineSigma, 2)} m</b>
                <ProvenanceTag value="simulated" />
              </dd>
            </div>
            <div>
              <dt>Current, {CURRENT ? formatDate(CURRENT.date) : ''}</dt>
              <dd>
                {n(c.currentRL, 2)} m RL <b>±{n(c.currentSigma, 2)} m</b>
                <ProvenanceTag value="simulated" />
              </dd>
            </div>
            <div>
              <dt>Difference</dt>
              <dd>
                {sign(c.dh, 2)} m <b>±{n(c.dhSigma, 2)} m</b>
                <ProvenanceTag value="derived" />
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="case-2">
          <h3 id="case-2" className="case-step">
            <span aria-hidden="true">2</span> Keep only real change
          </h3>
          <p className="case-text">
            Survey noise alone could move a height by up to {n(c.noiseBand, 2)} m ({cfg.k}σ). R1
            reports a change only beyond {n(c.threshold, 2)} m ({cfg.minChangeM} m + {cfg.k}σ). This
            cell is {c.dh < 0 ? 'lower' : 'higher'} by {n(Math.abs(c.dh), 2)} m, about {n(times)}{' '}
            times the threshold, so it counts.
          </p>
          <NumberLine c={c} />
        </section>
      </div>

      <section aria-labelledby="case-3" className="case-permit">
        <div>
          <h3 id="case-3" className="case-step">
            <span aria-hidden="true">3</span> Check it against the permit
          </h3>
          <p className="case-text">
            R1 tests whether excavated ground lies outside the lease boundary. The centre of this
            cell is {n(c.leaseDistance, 1)} m {outside ? 'outside' : 'inside'} it (position ±
            {n(c.horizontalSigma, 2)} m, 1σ), so{' '}
            {outside ? 'R1 reports a violation' : 'R1 tests it against the safety buffer'}.
          </p>
        </div>
        <Section c={c} />
      </section>

      <div className="case-verdict" data-tone={tone}>
        <div className="case-verdict-head">
          <Glyph className="h-6 w-6 shrink-0 text-(--tone)" />
          <div>
            <h3 className="cond text-[24px] leading-tight font-bold text-ink">
              {f.id}: {f.status === 'violation' ? 'violation' : 'warning'}, {f.severity} severity
            </h3>
            <p className="text-[13.5px] leading-6 text-ink-dim">
              The engine’s result for this simulated scenario. It points an inspector at a place to
              look; it does not prove a breach.
            </p>
          </div>
        </div>
        <dl className="case-figures">
          {[
            ['Area', `${n(f.areaM2)} m²`],
            ['Volume', `${n(f.volumeM3)} m³`],
            ['Max excess', `${n(f.maxExceedance, 1)} m`],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="btn" onClick={onShowOnModel}>
          See {f.id} on the 3D model
        </button>
      </div>
    </article>
  )
}

/**
 * The change against the two lines it has to clear. The axis stops a little past the reporting
 * threshold; a change far beyond it is pinned to the right edge and says so, because drawing it
 * to scale would squeeze both lines into the left pixel.
 */
function NumberLine({ c }: { c: Case }) {
  const size = Math.abs(c.dh)
  const max = Math.max(1, c.threshold * 1.4)
  const off = size > max
  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`
  return (
    <figure className="mt-5">
      <div
        role="img"
        aria-label={`Number line from 0 to ${n(max, 1)} metres. Noise band to ${n(c.noiseBand, 2)} metres, reporting threshold at ${n(c.threshold, 2)} metres, the change of ${n(size, 2)} metres ${off ? 'beyond the end of the line' : 'marked'}.`}
      >
        <div className="noise-line">
          <div className="noise-band" style={{ width: pct(c.noiseBand) }} />
          <div className="noise-limit" style={{ left: pct(c.threshold) }} />
          <div
            className="noise-marker real"
            style={{ left: off ? 'calc(100% - 10px)' : pct(size) }}
          />
        </div>
        <div className="mt-3 flex justify-between font-mono text-[13px] text-ink-faint">
          <span>0 m</span>
          <span>{off ? `change ${n(size, 1)} m, off this scale →` : `${n(max, 1)} m`}</span>
        </div>
      </div>
      <figcaption className="mt-1 text-[13px] leading-5 text-ink-faint">
        Shaded: noise band ({COMPLIANCE_CONFIG.k}σ). Dashed: R1 threshold. Diamond: this cell’s
        change.
      </figcaption>
    </figure>
  )
}

const W = 400
const H = 190

/** SVG path through samples, starting a new segment after each gap. */
function pathOf(d: number[], z: number[], x: (v: number) => number, y: (v: number) => number) {
  let out = ''
  let pen = false
  z.forEach((v, i) => {
    if (Number.isNaN(v)) {
      pen = false
      return
    }
    out += `${pen ? 'L' : 'M'}${x(d[i]!).toFixed(1)} ${y(v).toFixed(1)}`
    pen = true
  })
  return out
}

/**
 * Cross-section at right angles to the lease edge through the cell: the current surface, the
 * baseline, and the material between them. The lease edge and the cell are marked; labels are
 * HTML so they stay at a readable size when the drawing scales.
 */
function Section({ c }: { c: Case }) {
  const { section: s } = c
  const [now, base] = s.series as [number[], number[]]
  const finite = [...now, ...base].filter((v) => !Number.isNaN(v))
  if (finite.length === 0) return null
  const lo = Math.min(...finite)
  const hi = Math.max(...finite)
  const pad = Math.max((hi - lo) * 0.08, 1)
  const [y0, y1] = [lo - pad, hi + pad]
  const x = (d: number) => (d / s.length) * W
  const y = (z: number) => H - ((z - y0) / (y1 - y0)) * H
  const edgeX = x(c.edgeAt)
  const cellX = x(c.cellAt)

  // Material removed: the strip between the baseline and the current surface where it is lower.
  let cut = ''
  for (let i = 0; i < s.d.length; i++) {
    if (Number.isNaN(now[i]!) || Number.isNaN(base[i]!)) continue
    cut += `${cut ? 'L' : 'M'}${x(s.d[i]!).toFixed(1)} ${y(Math.min(base[i]!, now[i]!)).toFixed(1)}`
  }
  let top = ''
  for (let i = s.d.length - 1; i >= 0; i--) {
    if (Number.isNaN(now[i]!) || Number.isNaN(base[i]!)) continue
    top += `L${x(s.d[i]!).toFixed(1)} ${y(Math.max(base[i]!, now[i]!)).toFixed(1)}`
  }
  const left = (px: number) => `${(px / W) * 100}%`

  return (
    <figure className="case-section">
      <div className="case-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Cross-section ${n(s.length)} m long through ${c.finding.id}, from ${n(lo)} to ${n(hi)} metres RL. The lease boundary is ${n(c.leaseDistance, 1)} metres from the cell. Baseline ground is higher than the current surface at the cell.`}
          className="block w-full"
        >
          <rect x={0} y={0} width={edgeX} height={H} className="case-outside" />
          {cut && <path d={`${cut}${top}Z`} className="case-cut" />}
          <path d={pathOf(s.d, base, x, y)} className="case-base" />
          <path d={pathOf(s.d, now, x, y)} className="case-now" />
          <line x1={edgeX} x2={edgeX} y1={0} y2={H} className="case-edge" />
          <line x1={cellX} x2={cellX} y1={0} y2={H} className="case-cellline" />
        </svg>
        <span className="case-tag" style={{ left: left(edgeX) }} aria-hidden="true">
          Lease boundary
        </span>
        <span className="case-tag case-tag-cell" style={{ left: left(cellX) }} aria-hidden="true">
          {c.finding.id} cell
        </span>
        <span className="case-y case-y-hi" aria-hidden="true">
          {n(hi)} m RL
        </span>
        <span className="case-y case-y-lo" aria-hidden="true">
          {n(lo)} m RL
        </span>
      </div>
      <figcaption className="case-legend">
        <span>
          <i className="case-key case-key-now" /> Current surface, ±{n(c.currentSigma, 2)} m
        </span>
        <span>
          <i className="case-key case-key-base" /> Baseline, ±{n(c.baselineSigma, 2)} m
        </span>
        <span>
          <i className="case-key case-key-cut" /> Removed between the surveys
        </span>
        <span>Left of the boundary: outside the lease. Vertical scale fitted to the data.</span>
      </figcaption>
    </figure>
  )
}

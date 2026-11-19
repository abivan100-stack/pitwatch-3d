import { useId, useMemo, useState } from 'react'
import { findingDetail, type SeverityMeasure } from '../../compliance/findingDetail'
import type {
  ComplianceFinding,
  PermittedLimits,
  Provenance,
  TerrainSurvey,
} from '../../domain/types'
import { centerOfIndex } from '../../geo/grid'
import { svgPolygonPath } from '../../geo/planLayout'
import { cellIndicesToSvgPath } from '../../geo/sitePlan'
import { toneOf } from '../findings'
import { ProvenanceTag } from '../ProvenanceTag'

const n = (v: number, digits = 0) =>
  v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const signed = (v: number, digits: number) => `${v > 0 ? '+' : ''}${n(v, digits)}`

const MEASURE: Record<SeverityMeasure, { label: string; unit: string; digits: number }> = {
  area: { label: 'Area', unit: 'm²', digits: 0 },
  volume: { label: 'Volume', unit: 'm³', digits: 0 },
  exceedance: { label: 'Exceedance', unit: 'm', digits: 1 },
}

interface Surveys {
  current: TerrainSurvey
  baseline: TerrainSurvey
  limits: PermittedLimits
}

/** The Details disclosure of a finding row: evidence from the surveys, closed until asked for. */
export function FindingDetails({ f, ...s }: { f: ComplianceFinding } & Surveys) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="fd">
      <button
        type="button"
        className="fd-btn no-print"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        Details
      </button>
      <div id={id} className="fd-wrap" data-open={open || undefined}>
        {/* inert: a closed body takes no focus and is skipped by assistive technology. */}
        <div className="fd-body" inert={!open}>
          <p>{f.explanation}</p>
          <DetailBody f={f} {...s} />
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, prov }: { label: string; value: string; prov: Provenance }) {
  return (
    <div className="fd-row">
      <dt>{label}</dt>
      <dd>
        {value} <ProvenanceTag value={prov} />
      </dd>
    </div>
  )
}

function DetailBody({ f, current, baseline, limits }: { f: ComplianceFinding } & Surveys) {
  const d = useMemo(
    () => findingDetail(f, current, baseline, limits),
    [f, current, baseline, limits],
  )
  const pm = `± ${n(d.dhSigma, 2)} m`
  const peakLabel = f.ruleId === 'R3' ? 'Highest cell' : 'Deepest cell'
  const e = (p: { x: number; y: number }) => `E ${n(p.x)} m, N ${n(p.y)} m`
  const sigmaV = current.verticalUncertainty
  const side = d.where.insideLease ? 'inside' : 'outside'

  return (
    <div className="fd-grid">
      <section aria-label={`Measurements for ${f.id}`}>
        <h4>Measurements</h4>
        <dl>
          <Row
            label="Cells"
            value={`${n(d.cellCount)} of ${n(current.grid.cellSize)} m`}
            prov="derived"
          />
          <Row label="Mean change" value={`${signed(d.meanDh, 2)} m ${pm}`} prov="derived" />
          <Row label="Lowest change" value={`${signed(d.minDh, 2)} m ${pm}`} prov="derived" />
          <Row label="Highest change" value={`${signed(d.maxDh, 2)} m ${pm}`} prov="derived" />
          <Row
            label={`Baseline level, ${peakLabel.toLowerCase()}`}
            value={`${n(d.peak.baseline, 1)} m RL ± ${n(baseline.verticalUncertainty, 2)} m`}
            prov="simulated"
          />
          <Row
            label={`Current level, ${peakLabel.toLowerCase()}`}
            value={`${n(d.peak.current, 1)} m RL ± ${n(sigmaV, 2)} m`}
            prov="simulated"
          />
          <Row
            label="Largest exceedance"
            value={`${n(f.maxExceedance, 1)} m at ${e(d.peak.p)}`}
            prov="derived"
          />
        </dl>
      </section>
      <section aria-label={`Why ${f.id} has this rating`}>
        <h4>Why this rating</h4>
        {d.rating.line ? (
          <>
            <p>
              Rated {f.severity} because at least one measure reached the {d.rating.line} line:
            </p>
            <ul>
              {d.rating.measures.map(({ measure, value, threshold }) => {
                const m = MEASURE[measure]
                return (
                  <li key={measure}>
                    {m.label} {n(value, m.digits)} {m.unit} ({d.rating.line} from{' '}
                    {threshold.toLocaleString('en-GB')} {m.unit}) <ProvenanceTag value="derived" />
                  </li>
                )
              })}
            </ul>
          </>
        ) : (
          <p>
            Rated {f.severity}: no measure reached the{' '}
            {f.status === 'violation' ? 'critical' : 'medium'} line.{' '}
            <ProvenanceTag value="derived" />
          </p>
        )}
      </section>
      <section aria-label={`Where ${f.id} is`}>
        <h4>Where</h4>
        <dl>
          <Row label="Centre" value={e(d.where.centroid)} prov="derived" />
          <Row
            label="Distance to lease boundary"
            value={`${n(d.where.leaseDistance)} m ${side} ± ${n(current.horizontalUncertainty, 2)} m`}
            prov="derived"
          />
          {d.where.pitZoneId && (
            <Row
              label="Pit zone"
              value={`${d.where.pitZoneId}, approved floor ${n(d.where.pitFloor ?? 0)} m RL`}
              prov="simulated"
            />
          )}
        </dl>
      </section>
      <FindingPlan f={f} current={current} limits={limits} />
    </div>
  )
}

/** The lease with this finding's cells outlined; vector, from the same geometry as the Overview. */
function FindingPlan({
  f,
  current,
  limits,
}: {
  f: ComplianceFinding
  current: TerrainSurvey
  limits: PermittedLimits
}) {
  const g = current.grid
  const plan = useMemo(() => {
    const top = g.originXY.y + (g.rows - 1) * g.cellSize + g.cellSize / 2
    const xs = limits.leaseBoundary.map((p) => p.x)
    const ys = limits.leaseBoundary.map((p) => p.y)
    for (const i of f.cells) {
      const c = centerOfIndex(g, i)
      xs.push(c.x - g.cellSize / 2, c.x + g.cellSize / 2)
      ys.push(c.y - g.cellSize / 2, c.y + g.cellSize / 2)
    }
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const pad = Math.max(x1 - x0, y1 - y0) * 0.04
    return {
      top,
      view: `${x0 - pad} ${top - (y1 + pad)} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`,
      width: x1 - x0 + 2 * pad,
      cells: cellIndicesToSvgPath(g, f.cells),
    }
  }, [f.cells, g, limits.leaseBoundary])
  const label = `Plan of the lease with ${f.id} outlined: ${f.cells.length} cells centred at east ${n(f.centroid.x)} m, north ${n(f.centroid.y)} m.`

  return (
    <figure className="fd-plan">
      <svg viewBox={plan.view} role="img" aria-label={label}>
        <path d={svgPolygonPath(limits.leaseBoundary, plan.top)} className="plan-line plan-lease" />
        {limits.pitZones.map((z) => (
          <path key={z.id} d={svgPolygonPath(z.polygon, plan.top)} className="plan-line plan-pit" />
        ))}
        <path d={plan.cells} className={`plan-finding-area tone-${toneOf(f)}`} fillRule="evenodd" />
        {/* A ring at the centre keeps a small finding findable at plan scale. */}
        <circle
          cx={f.centroid.x}
          cy={plan.top - f.centroid.y}
          r={plan.width * 0.02}
          className={`fd-ring tone-${toneOf(f)}`}
        />
      </svg>
      <figcaption>
        Lease boundary, pit zones (dashed) and {f.id}. <ProvenanceTag value="derived" />
      </figcaption>
    </figure>
  )
}

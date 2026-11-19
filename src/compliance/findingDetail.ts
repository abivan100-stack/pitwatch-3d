import type { ComplianceFinding, PermittedLimits, TerrainSurvey, Vec2 } from '../domain/types'
import { centerOfIndex } from '../geo/grid'
import { distanceToBoundary, polygonArea } from '../geo/polygon'
import { COMPLIANCE_CONFIG, type ComplianceConfig, type SeverityThresholds } from './config'
import { severityOf } from './engine'
import { leaseVerdict, type LeaseVerdict } from './inspect'
import { combinedSigma } from './uncertainty'

export type SeverityMeasure = 'area' | 'volume' | 'exceedance'

export interface RatingMeasure {
  measure: SeverityMeasure
  value: number
  /** The configured line this measure reached (m², m³ or m). */
  threshold: number
}

/** The evidence behind one finding, computed from the surveys; the finding record is unchanged. */
export interface FindingDetail {
  cellCount: number
  /** Change (current - baseline) across the finding's cells, metres. */
  meanDh: number
  minDh: number
  maxDh: number
  /** Combined 1σ of one cell's change, metres. */
  dhSigma: number
  /** The cell behind `maxExceedance`: the deepest cut, lowest ground below a floor, or highest fill. */
  peak: { p: Vec2; baseline: number; current: number; dh: number }
  /**
   * Which configured line set the rating. `line` is null when no measure reached the next line
   * (a violation rated high, a warning rated low); otherwise `measures` lists every one that did.
   */
  rating: { line: 'critical' | 'medium' | null; measures: RatingMeasure[] }
  where: {
    centroid: Vec2
    /** Distance from the centroid to the lease boundary, metres. */
    leaseDistance: number
    /** Side of the lease the centroid can honestly claim, within the k·σ horizontal band. */
    leaseSide: LeaseVerdict
    pitZoneId?: string
    pitFloor?: number
  }
}

function ratingOf(
  f: ComplianceFinding,
  cfg: ComplianceConfig,
): { line: 'critical' | 'medium' | null; measures: RatingMeasure[] } {
  // The engine decides the rating; this only lists the measures behind it, so the two cannot drift.
  const severity = severityOf(f.status, f.areaM2, f.volumeM3, f.maxExceedance, cfg)
  if (severity !== 'critical' && severity !== 'medium') return { line: null, measures: [] }
  const line = severity
  const t: SeverityThresholds = line === 'critical' ? cfg.critical : cfg.mediumWarning
  const measures = (
    [
      ['area', f.areaM2, t.areaM2],
      ['volume', f.volumeM3, t.volumeM3],
      ['exceedance', f.maxExceedance, t.exceedanceM],
    ] as const
  )
    .filter(([, value, threshold]) => value >= threshold)
    .map(([measure, value, threshold]) => ({ measure, value, threshold }))
  return { line, measures }
}

/** Measurements, rating basis and location for one finding. Pure; both surveys share a grid. */
export function findingDetail(
  f: ComplianceFinding,
  current: TerrainSurvey,
  baseline: TerrainSurvey,
  limits: PermittedLimits,
  cfg: ComplianceConfig = COMPLIANCE_CONFIG,
): FindingDetail {
  let sum = 0
  let minDh = Infinity
  let maxDh = -Infinity
  let peakCell = f.cells[0]!
  let peakKey = -Infinity
  for (const i of f.cells) {
    const dh = current.elevations[i]! - baseline.elevations[i]!
    sum += dh
    minDh = Math.min(minDh, dh)
    maxDh = Math.max(maxDh, dh)
    // R1 deepest cut = most negative change, R2 lowest ground, R3 highest fill.
    const key = f.ruleId === 'R3' ? dh : f.ruleId === 'R2' ? -current.elevations[i]! : -dh
    if (key > peakKey) {
      peakKey = key
      peakCell = i
    }
  }
  const zone = f.pitZoneId ? limits.pitZones.find((z) => z.id === f.pitZoneId) : undefined
  const peakCurrent = current.elevations[peakCell]!
  const peakBase = baseline.elevations[peakCell]!
  const c = f.centroid
  return {
    cellCount: f.cells.length,
    meanDh: sum / f.cells.length,
    minDh,
    maxDh,
    dhSigma: combinedSigma(baseline.verticalUncertainty, current.verticalUncertainty),
    peak: {
      p: centerOfIndex(current.grid, peakCell),
      baseline: peakBase,
      current: peakCurrent,
      dh: peakCurrent - peakBase,
    },
    rating: ratingOf(f, cfg),
    where: {
      centroid: c,
      leaseDistance: distanceToBoundary(c, limits.leaseBoundary),
      leaseSide: leaseVerdict(c, limits.leaseBoundary, current.horizontalUncertainty, cfg.k),
      ...(zone ? { pitZoneId: zone.id, pitFloor: zone.approvedFloorElevation } : {}),
    },
  }
}

/** Totals over the shown findings. The Overview's boundary-violation volume is a subset of these. */
export interface FindingTotals {
  areaM2: number
  /** Volume of R1 and R2 findings (material removed, or below the approved floor). */
  excavatedM3: number
  /** Volume of R3 findings (material placed). */
  filledM3: number
  /** Flagged area as a share of the lease polygon's area, 0..1. */
  leaseShare: number
}

export function findingTotals(
  findings: readonly ComplianceFinding[],
  limits: PermittedLimits,
): FindingTotals {
  let areaM2 = 0
  let excavatedM3 = 0
  let filledM3 = 0
  for (const f of findings) {
    areaM2 += f.areaM2
    if (f.ruleId === 'R3') filledM3 += f.volumeM3
    else excavatedM3 += f.volumeM3
  }
  return { areaM2, excavatedM3, filledM3, leaseShare: areaM2 / polygonArea(limits.leaseBoundary) }
}

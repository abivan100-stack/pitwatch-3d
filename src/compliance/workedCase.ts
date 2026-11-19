import type { ComplianceFinding, PermittedLimits, TerrainSurvey, Vec2 } from '../domain/types'
import { centerOfIndex } from '../geo/grid'
import { nearestOnBoundary } from '../geo/polygon'
import { profileAlong, type Profile } from '../geo/profile'
import { changeThreshold } from './change'
import { COMPLIANCE_CONFIG, type ComplianceConfig } from './config'
import type { Evaluation } from './engine'
import { readPoint, type LeaseVerdict } from './inspect'

/** The finding the landing page follows through the method. Fixed, not rotated (issue #71). */
export const WORKED_FINDING_ID = 'R1-1'

/** How far the section runs back behind the cell, and on past the lease edge, metres. */
const BEHIND_CELL = 30
const PAST_EDGE = 90

/** One finding followed through survey, change and permit, every figure read from the engine. */
export interface WorkedCase {
  finding: ComplianceFinding
  /** Centre of the finding's most-changed cell, local metres. */
  p: Vec2
  baselineRL: number
  currentRL: number
  /** 1σ vertical uncertainty of each survey, metres. */
  baselineSigma: number
  currentSigma: number
  /** current − baseline at the cell, and its combined 1σ. */
  dh: number
  dhSigma: number
  /** k·σ, the noise band. */
  noiseBand: number
  /** minChange + k·σ, the R1/R3 reporting threshold. */
  threshold: number
  leaseSide: LeaseVerdict
  /** Distance from the cell to the lease boundary, metres. */
  leaseDistance: number
  /** 1σ horizontal position uncertainty of the current survey, metres. */
  horizontalSigma: number
  /** Elevation along a line through the cell and across the lease edge: series[0] current, [1] baseline. */
  section: Profile
  /** Distance along `section` of the cell and of the lease edge, metres. */
  cellAt: number
  edgeAt: number
}

/**
 * Builds the worked case for one finding, or null when the finding is absent or its cell is
 * off the survey grid. The cell is the finding's most-changed one, so the change shown is the
 * finding's own "max excess". Pure: it reads the same figures the Inspector does.
 */
export function workedCase(
  baseline: TerrainSurvey,
  current: TerrainSurvey,
  limits: PermittedLimits,
  evaluation: Evaluation,
  id: string = WORKED_FINDING_ID,
  cfg: Pick<ComplianceConfig, 'k' | 'minChangeM'> = COMPLIANCE_CONFIG,
): WorkedCase | null {
  const finding = evaluation.findings.find((f) => f.id === id)
  if (!finding || finding.cells.length === 0) return null
  const { dh } = evaluation.change
  const cell = finding.cells.reduce((a, b) => (Math.abs(dh[b]) > Math.abs(dh[a]) ? b : a))
  const p = centerOfIndex(current.grid, cell)
  const r = readPoint(p, baseline, current, limits, evaluation, cfg)
  if (r.elevation === null || r.baseline === null || r.dh === null) return null

  // A line at right angles to the lease edge through the cell: BEHIND_CELL metres back from the
  // cell, across the edge (leaseDistance ahead of the cell), then PAST_EDGE metres beyond it.
  const edge = nearestOnBoundary(p, limits.leaseBoundary)
  const len = Math.hypot(edge.x - p.x, edge.y - p.y)
  const dir = len > 0 ? { x: (edge.x - p.x) / len, y: (edge.y - p.y) / len } : { x: 1, y: 0 }
  const start = { x: p.x - dir.x * BEHIND_CELL, y: p.y - dir.y * BEHIND_CELL }
  const end = { x: p.x + dir.x * (len + PAST_EDGE), y: p.y + dir.y * (len + PAST_EDGE) }
  const section = profileAlong(current.grid, start, end, current.elevations, baseline.elevations)

  return {
    finding,
    p,
    baselineRL: r.baseline,
    currentRL: r.elevation,
    baselineSigma: baseline.verticalUncertainty,
    currentSigma: current.verticalUncertainty,
    dh: r.dh,
    dhSigma: r.dhSigma,
    noiseBand: cfg.k * r.dhSigma,
    threshold: changeThreshold(r.dhSigma, cfg),
    leaseSide: r.leaseSide,
    leaseDistance: r.leaseDistance,
    horizontalSigma: r.horizontalSigma,
    section,
    cellAt: BEHIND_CELL,
    edgeAt: BEHIND_CELL + len,
  }
}

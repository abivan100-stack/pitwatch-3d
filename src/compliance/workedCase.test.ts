import { beforeAll, describe, expect, it } from 'vitest'
import { SyntheticTerrainProvider } from '../data/SyntheticTerrainProvider'
import type { PermittedLimits, TerrainSurvey } from '../domain/types'
import { distanceToBoundary, pointInPolygon } from '../geo/polygon'
import { COMPLIANCE_CONFIG } from './config'
import { evaluate, type Evaluation } from './engine'
import { combinedSigma } from './uncertainty'
import { workedCase, WORKED_FINDING_ID } from './workedCase'

let baseline: TerrainSurvey
let current: TerrainSurvey
let limits: PermittedLimits
let evaluation: Evaluation

beforeAll(async () => {
  const p = new SyntheticTerrainProvider()
  ;[baseline, current, limits] = await Promise.all([
    p.getSurvey('baseline'),
    p.getSurvey('current'),
    p.getLimits(),
  ])
  evaluation = evaluate(baseline, current, limits)
}, 120_000)

describe('worked case for the landing page', () => {
  it('follows R1-1 and reports the finding’s own figures', () => {
    const c = workedCase(baseline, current, limits, evaluation)!
    const finding = evaluation.findings.find((f) => f.id === WORKED_FINDING_ID)!
    expect(c.finding).toBe(finding)
    // The change at the chosen cell is the finding's max excess.
    expect(Math.abs(c.dh)).toBeCloseTo(finding.maxExceedance, 1)
  })

  it('takes both heights and their uncertainty from the surveys', () => {
    const c = workedCase(baseline, current, limits, evaluation)!
    expect(c.baselineSigma).toBe(baseline.verticalUncertainty)
    expect(c.currentSigma).toBe(current.verticalUncertainty)
    expect(c.dh).toBeCloseTo(c.currentRL - c.baselineRL, 9)
    expect(c.dhSigma).toBeCloseTo(combinedSigma(c.baselineSigma, c.currentSigma), 12)
    // The two lines on the number line are the engine's own 0.14 m and 0.64 m.
    expect(c.noiseBand).toBeCloseTo(0.14, 2)
    expect(c.threshold).toBeCloseTo(0.64, 2)
    expect(c.threshold).toBeCloseTo(
      COMPLIANCE_CONFIG.minChangeM + COMPLIANCE_CONFIG.k * c.dhSigma,
      12,
    )
  })

  it('puts the cell outside the lease and the section line across the edge', () => {
    const c = workedCase(baseline, current, limits, evaluation)!
    expect(pointInPolygon(c.p, limits.leaseBoundary)).toBe(false)
    expect(c.leaseSide).toBe('outside')
    expect(c.leaseDistance).toBeCloseTo(distanceToBoundary(c.p, limits.leaseBoundary), 9)

    // The cell sits at cellAt along the line and the lease edge at edgeAt, leaseDistance apart.
    expect(c.edgeAt - c.cellAt).toBeCloseTo(c.leaseDistance, 6)
    const at = (d: number) => {
      const i = c.section.d.findIndex((x) => x >= d)
      return c.section.points[i]
    }
    const nearEdge = at(c.edgeAt)
    expect(distanceToBoundary(nearEdge, limits.leaseBoundary)).toBeLessThan(c.section.step)
    // It starts outside the lease and ends inside it.
    expect(pointInPolygon(c.section.points[0], limits.leaseBoundary)).toBe(false)
    expect(pointInPolygon(c.section.points.at(-1)!, limits.leaseBoundary)).toBe(true)
  })

  it('returns null when the finding does not exist', () => {
    expect(workedCase(baseline, current, limits, evaluation, 'R9-9')).toBeNull()
  })
})

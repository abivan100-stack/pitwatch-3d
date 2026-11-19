import { describe, expect, it } from 'vitest'
import type {
  ComplianceFinding,
  GridSpec,
  PermittedLimits,
  PitZone,
  TerrainSurvey,
} from '../domain/types'
import { COMPLIANCE_CONFIG } from './config'
import { evaluate } from './engine'
import { findingDetail, findingTotals } from './findingDetail'

const G: GridSpec = { cols: 4, rows: 4, cellSize: 10, originXY: { x: 0, y: 0 } }
const square = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]
const survey = (id: string, elevations: number[]): TerrainSurvey => ({
  id,
  label: id === 'baseline' ? 'Baseline' : 'Current',
  date: '2026-01-01',
  method: 'test',
  provenance: 'simulated',
  grid: G,
  elevations: Float32Array.from(elevations),
  verticalUncertainty: 0.05,
  horizontalUncertainty: 0.1,
})
const limits = (pitZones: PitZone[] = []): PermittedLimits => ({
  leaseBoundary: square(-5, -5, 35, 35),
  safetyBufferMetres: 5,
  pitZones,
  maxPitDepth: 10,
  dumpZones: [],
})

const flat = (z: number) => new Array<number>(16).fill(z)
const finding = (over: Partial<ComplianceFinding>): ComplianceFinding => ({
  id: 'R1-1',
  ruleId: 'R1',
  type: 'boundary-encroachment',
  status: 'violation',
  severity: 'critical',
  cells: [0, 1],
  areaM2: 200,
  volumeM3: 1000,
  maxExceedance: 5,
  centroid: { x: 5, y: 0 },
  explanation: '',
  provenance: 'derived',
  ...over,
})
const base = survey('baseline', flat(100))
const cur = survey('current', [97, 99, ...flat(100).slice(2)])

describe('findingDetail measurements', () => {
  it('summarises the change over the finding cells and finds the deepest cell', () => {
    const d = findingDetail(finding({}), cur, base, limits())
    expect(d.cellCount).toBe(2)
    expect(d.meanDh).toBeCloseTo(-2)
    expect(d.minDh).toBeCloseTo(-3)
    expect(d.maxDh).toBeCloseTo(-1)
    expect(d.dhSigma).toBeCloseTo(Math.SQRT2 * 0.05)
    expect(d.peak).toMatchObject({ p: { x: 0, y: 0 }, baseline: 100, current: 97, dh: -3 })
  })

  it('reports the lowest ground as the peak of a depth finding, not the deepest cut', () => {
    // Cell 0 is the lowest ground (89 m) but cell 1 lost the most (5 m): R2 is about the floor.
    const before = survey('baseline', [90, 100, ...flat(100).slice(2)])
    const after = survey('current', [89, 95, ...flat(100).slice(2)])
    const f = finding({ ruleId: 'R2', cells: [0, 1] })
    expect(findingDetail(f, after, before, limits()).peak.p).toEqual({ x: 0, y: 0 })
    // An R1 finding on the same cells peaks at the deepest cut instead.
    expect(findingDetail(finding({ cells: [0, 1] }), after, before, limits()).peak.p).toEqual({
      x: 10,
      y: 0,
    })
  })

  it('reports the highest fill as the peak of a dumping finding', () => {
    const filled = survey('current', [100, 104, ...flat(100).slice(2)])
    const f = finding({ ruleId: 'R3', cells: [0, 1] })
    expect(findingDetail(f, filled, base, limits()).peak.p).toEqual({ x: 10, y: 0 })
  })

  it('measures the centroid against the lease boundary', () => {
    const d = findingDetail(finding({ centroid: { x: 50, y: 0 } }), cur, base, limits())
    expect(d.where.leaseSide).toBe('outside')
    expect(d.where.leaseDistance).toBeCloseTo(15)
  })

  it('does not claim a side when the centroid is within the 2σ band of the boundary', () => {
    // Lease edge at x = 35; horizontal σ 0.1 m, so the 2σ band is 0.2 m.
    const near = findingDetail(finding({ centroid: { x: 35.15, y: 10 } }), cur, base, limits())
    expect(near.where.leaseSide).toBe('unconfirmed')
    const clear = findingDetail(finding({ centroid: { x: 34.5, y: 10 } }), cur, base, limits())
    expect(clear.where.leaseSide).toBe('inside')
  })
})

describe('findingDetail rating', () => {
  const c = COMPLIANCE_CONFIG.critical
  it('lists all three measures of a finding that passes every critical line (R1-1)', () => {
    const f = finding({ areaM2: 7696, volumeM3: 175297, maxExceedance: 52.5 })
    const { rating } = findingDetail(f, cur, base, limits())
    expect(rating.line).toBe('critical')
    expect(rating.measures).toEqual([
      { measure: 'area', value: 7696, threshold: c.areaM2 },
      { measure: 'volume', value: 175297, threshold: c.volumeM3 },
      { measure: 'exceedance', value: 52.5, threshold: c.exceedanceM },
    ])
  })

  it('lists only the one measure that passed', () => {
    const f = finding({ areaM2: 100, volumeM3: 100, maxExceedance: c.exceedanceM + 2 })
    const { rating } = findingDetail(f, cur, base, limits())
    expect(rating.measures.map((m) => m.measure)).toEqual(['exceedance'])
  })

  it('has no measure for a warning rated low, or a violation rated high', () => {
    const low = finding({
      status: 'warning',
      severity: 'low',
      areaM2: 10,
      volumeM3: 10,
      maxExceedance: 0.8,
    })
    expect(findingDetail(low, cur, base, limits()).rating).toEqual({ line: null, measures: [] })
    const high = finding({ severity: 'high', areaM2: 10, volumeM3: 10, maxExceedance: 1 })
    expect(findingDetail(high, cur, base, limits()).rating.line).toBeNull()
  })

  it('uses the medium line for a warning that reaches it', () => {
    const m = COMPLIANCE_CONFIG.mediumWarning
    const f = finding({
      status: 'warning',
      severity: 'medium',
      areaM2: m.areaM2,
      volumeM3: 0,
      maxExceedance: 0,
    })
    const { rating } = findingDetail(f, cur, base, limits())
    expect(rating).toEqual({
      line: 'medium',
      measures: [{ measure: 'area', value: m.areaM2, threshold: m.areaM2 }],
    })
  })
})

describe('findingDetail pit zone', () => {
  const zone = (id: string, floor: number): PitZone => ({
    id,
    polygon: square(0, 0, 35, 35),
    approvedFloorElevation: floor,
  })

  it('names the zone behind a finding that spans two overlapping zones', () => {
    const zones = [zone('zone-shallow', 100.05), zone('zone-deep', 106.5)]
    const s = survey('current', flat(100))
    const permit = limits(zones)
    const f = evaluate(s, s, permit).findings.find((x) => x.ruleId === 'R2')!
    const d = findingDetail(f, s, s, permit)
    expect(d.where.pitZoneId).toBe('zone-deep')
    expect(d.where.pitFloor).toBe(106.5)
  })

  it('gives no zone for a finding without one', () => {
    expect(findingDetail(finding({}), cur, base, limits()).where.pitZoneId).toBeUndefined()
  })
})

describe('findingTotals', () => {
  it('sums area, splits volume by cut and fill, and shares the lease area', () => {
    const t = findingTotals(
      [
        finding({ areaM2: 100, volumeM3: 1000 }),
        finding({ ruleId: 'R2', areaM2: 50, volumeM3: 200 }),
        finding({ ruleId: 'R3', areaM2: 25, volumeM3: 300 }),
      ],
      limits(),
    )
    expect(t).toMatchObject({ areaM2: 175, excavatedM3: 1200, filledM3: 300 })
    expect(t.leaseShare).toBeCloseTo(175 / 1600)
  })
})

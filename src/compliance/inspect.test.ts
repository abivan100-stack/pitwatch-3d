import { beforeAll, describe, expect, it } from 'vitest'
import { SyntheticTerrainProvider } from '../data/SyntheticTerrainProvider'
import type {
  ComplianceFinding,
  PermittedLimits,
  Polygon,
  TerrainSurvey,
  Vec2,
} from '../domain/types'
import { centerOfIndex } from '../geo/grid'
import { evaluate, type Evaluation } from './engine'
import { leaseVerdict, readPoint } from './inspect'
import { combinedSigma } from './uncertainty'

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
}, 30_000)

const readAt = (p: Vec2, findings = evaluation.findings, permit = limits) =>
  readPoint(p, baseline, current, permit, { change: evaluation.change, findings })

const read = (f: ComplianceFinding) => readAt(centerOfIndex(current.grid, f.cells[0]))

describe('point reading', () => {
  function boundaryExcavation() {
    const grid = { cols: 2, rows: 2, cellSize: 10, originXY: { x: 0, y: 0 } }
    const before = {
      ...baseline,
      grid,
      elevations: new Float32Array([100, 100, 100, 100]),
      verticalUncertainty: 0.05,
    }
    const after = {
      ...current,
      grid,
      elevations: new Float32Array([99, 100, 100, 100]),
      verticalUncertainty: 0.05,
    }
    const permit = { ...limits, pitZones: [], dumpZones: [] }
    const result = evaluate(before, after, permit)
    return (x: number) => readPoint({ x, y: 0 }, before, after, permit, result)
  }

  it('keeps the excavation verdict and finding off-centre while interpolating the point change', () => {
    const point = boundaryExcavation()
    const centre = point(0)
    expect(centre).toMatchObject({ change: 'excavated', dh: -1, findingIds: ['R1-1'] })

    const offCentre = point(4)
    expect(offCentre.dh).toBeCloseTo(-0.6)
    expect(offCentre.dhSigma).toBeCloseTo(Math.SQRT2 * 0.05)
    expect(offCentre).toMatchObject({ change: 'excavated', findingIds: ['R1-1'] })
  })

  it('omits findings half a cell past the sampled grid even when the nearest cell is flagged', () => {
    expect(boundaryExcavation()(-5)).toMatchObject({
      elevation: null,
      dh: null,
      change: 'none',
      findingIds: [],
    })
  })

  it('lists the finding under a cell and reads the change that caused it', () => {
    for (const f of evaluation.findings) {
      const r = read(f)
      expect(r.findingIds).toContain(f.id)
      expect(r.change).toBe(f.ruleId === 'R3' ? 'filled' : 'excavated')
    }
  })

  it('reports the permit status at the finding', () => {
    const { findings } = evaluation
    const encroachment = findings.find((f) => f.ruleId === 'R1' && f.status === 'violation')!
    expect(read(encroachment).insideLease).toBe(false)
    const scrape = findings.find((f) => f.ruleId === 'R1' && f.status === 'warning')!
    expect(read(scrape).inBuffer).toBe(true)
    const sump = findings.find((f) => f.ruleId === 'R2')!
    expect(read(sump).pit!.above!).toBeLessThan(0)
  })

  it('reads quiet ground as unchanged, with a slope and no findings', () => {
    const r = readAt({ x: 400, y: 400 }, [])
    expect(r.change).toBe('none')
    expect(r.insideLease).toBe(true)
    expect(r.pit).toBeNull()
    expect(r.slopeDeg).not.toBeNull()
    expect(r.dhSigma).toBeCloseTo(
      combinedSigma(baseline.verticalUncertainty, current.verticalUncertainty),
    )
  })

  it('has no reading outside the survey grid', () => {
    const r = readAt({ x: -50, y: 100 }, [])
    expect([r.elevation, r.dh, r.slopeDeg]).toEqual([null, null, null])
    expect(r.findingIds).toEqual([])
  })

  it('quotes the survey horizontal error and refuses a side it cannot confirm', () => {
    const edge = limits.leaseBoundary[0]!
    const onEdge = readAt(edge, [])
    expect(onEdge.horizontalSigma).toBe(current.horizontalUncertainty)
    expect(onEdge.horizontalBand).toBeCloseTo(2 * current.horizontalUncertainty, 12)
    expect(onEdge.leaseSide).toBe('unconfirmed')
    const clearlyInside = readAt({ x: 400, y: 400 }, [])
    expect(clearlyInside.leaseSide).toBe('inside')
    const clearlyOutside = readAt({ x: 2300, y: 400 }, [])
    expect(clearlyOutside.leaseSide).toBe('outside')
  })
})

describe('safety-buffer edge', () => {
  it('does not claim a side of the buffer edge inside the 2σ band', () => {
    const lease: Polygon = [
      { x: 100, y: 100 },
      { x: 1900, y: 100 },
      { x: 1900, y: 1900 },
      { x: 100, y: 1900 },
    ]
    const custom: PermittedLimits = { ...limits, leaseBoundary: lease, safetyBufferMetres: 20 }
    const onEdge = readAt({ x: 120, y: 1000 }, [], custom)
    expect(onEdge.bufferUnconfirmed).toBe(true)
    const beyond = readAt({ x: 125, y: 1000 }, [], custom)
    expect([beyond.bufferUnconfirmed, beyond.inBuffer]).toEqual([false, false])
    const within = readAt({ x: 115, y: 1000 }, [], custom)
    expect([within.bufferUnconfirmed, within.inBuffer]).toEqual([false, true])
  })
})

describe('lease verdict', () => {
  const square: Polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]

  it('confirms a side away from the boundary', () => {
    expect(leaseVerdict({ x: 50, y: 50 }, square, 0.1)).toBe('inside')
    expect(leaseVerdict({ x: 150, y: 50 }, square, 0.1)).toBe('outside')
  })

  it('is unconfirmed while the error band reaches the boundary, either side', () => {
    expect(leaseVerdict({ x: 100.05, y: 50 }, square, 0.1)).toBe('unconfirmed')
    expect(leaseVerdict({ x: 99.95, y: 50 }, square, 0.1)).toBe('unconfirmed')
    expect(leaseVerdict({ x: 100, y: 50 }, square, 0.1)).toBe('unconfirmed')
  })

  it('uses the 2σ band, not 1σ, like every other significance test', () => {
    // Beyond 1σ (0.1 m) but inside 2σ (0.2 m): still no side can be claimed.
    expect(leaseVerdict({ x: 100.15, y: 50 }, square, 0.1)).toBe('unconfirmed')
    expect(leaseVerdict({ x: 99.85, y: 50 }, square, 0.1)).toBe('unconfirmed')
    // Beyond 2σ the side is claimed.
    expect(leaseVerdict({ x: 100.25, y: 50 }, square, 0.1)).toBe('outside')
    expect(leaseVerdict({ x: 99.75, y: 50 }, square, 0.1)).toBe('inside')
    // The coverage factor is a parameter, so k = 1 gives the narrower band.
    expect(leaseVerdict({ x: 100.15, y: 50 }, square, 0.1, 1)).toBe('outside')
  })
})

describe('finding lookup by cell', () => {
  it('matches a linear scan for every finding cell', () => {
    const { findings } = evaluation
    for (const f of findings) {
      const cell = f.cells[0]
      const p = centerOfIndex(current.grid, cell)
      const expected = findings.filter((g) => g.cells.includes(cell)).map((g) => g.id)
      expect(readAt(p).findingIds).toEqual(expected)
    }
  })

  it('lists every finding on a shared cell, in findings order', () => {
    const { findings } = evaluation
    const cell = findings[0]!.cells[0]
    const template = findings[0]!
    // The seeded scenario has no shared cells, so this is the case the index has to get right.
    const shared: ComplianceFinding[] = [
      { ...template, id: 'S-1', cells: [cell, 7] },
      { ...template, id: 'S-2', cells: [cell] },
    ]
    const r = readAt(centerOfIndex(current.grid, cell), shared)
    expect(r.findingIds).toEqual(['S-1', 'S-2'])
  })

  it('keeps finding order rather than cell order', () => {
    const { findings } = evaluation
    const cell = findings[0]!.cells[0]
    const expected = findings.filter((f) => f.cells.includes(cell)).map((f) => f.id)
    const r = readAt(centerOfIndex(current.grid, cell))
    expect(r.findingIds).toEqual(expected)
    // A fresh findings array gets its own index and the same answer.
    expect(readAt(centerOfIndex(current.grid, cell), [...findings]).findingIds).toEqual(expected)
  })

  it('returns nothing on quiet ground and off the grid', () => {
    expect(readAt({ x: 400, y: 400 }).findingIds).toEqual([])
    expect(readAt({ x: -50, y: 100 }).findingIds).toEqual([])
  })
})

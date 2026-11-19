import { describe, expect, it } from 'vitest'
import type { GridSpec } from '../domain/types'
import { cellCenter, extent } from '../geo/grid'
import { APRON_CELL_M, APRON_FADE_M, APRON_REACH_M, apronGrid, apronHeights } from './apron'
import { GRID, SEED } from './fixtures/scenario'
import { naturalGround, trueSurface } from './synthetic'

const block = extent(GRID)

describe('apron lattice', () => {
  const a = apronGrid(GRID)

  it('reaches 3 km past every edge on a 32 m lattice aligned to the survey grid', () => {
    expect(a.grid.cellSize).toBe(APRON_CELL_M)
    expect(a.grid.cols).toBe(2048 / 32 + 2 * (APRON_REACH_M / 32) + 1)
    expect(a.grid.rows).toBe(a.grid.cols)
    // The first lattice vertex is the reach short of the block's origin; the hole is the block.
    expect(a.grid.originXY).toEqual({ x: -APRON_REACH_M, y: -APRON_REACH_M })
    expect(cellCenter(a.grid, a.hole.c0, a.hole.r0)).toEqual(block.min)
    expect(cellCenter(a.grid, a.hole.c1, a.hole.r1)).toEqual(block.max)
  })

  it('refuses a survey grid it cannot line up with', () => {
    const odd: GridSpec = { cols: 100, rows: 100, cellSize: 5, originXY: { x: 0, y: 0 } }
    expect(() => apronGrid(odd)).toThrow('line up')
  })

  it('fades out before its own outer edge, so the edge is never seen', () => {
    expect(APRON_FADE_M.from).toBeLessThan(APRON_FADE_M.to)
    expect(APRON_FADE_M.to).toBeLessThanOrEqual(APRON_REACH_M)
  })
})

describe('apron heights', () => {
  const a = apronGrid(GRID)
  const heights = apronHeights(a, SEED)

  it('are the natural ground at every lattice vertex they sample', () => {
    for (const [col, row] of [
      [0, 0],
      [3, 200],
      [60, 17],
      [252, 252],
      [120, 250],
      [250, 90],
    ]) {
      const p = cellCenter(a.grid, col, row)
      expect(heights[row * a.grid.cols + col]).toBeCloseTo(naturalGround(p, SEED), 3)
    }
  })

  it('meet the survey at its edge: the block edge matches the first ring within 0.05 m', () => {
    // The survey cell is the mean of four sub-samples of the true ground (noise-free; the survey
    // adds its own +/-0.05 m 1-sigma noise to every cell on top of this, as it does everywhere).
    const surveyGround = (x: number, y: number) => {
      const o = GRID.cellSize / 4
      let sum = 0
      for (const [dx, dy] of [
        [-o, -o],
        [o, -o],
        [-o, o],
        [o, o],
      ]) {
        sum += trueSurface({ x: x + dx, y: y + dy }, 'current', SEED)
      }
      return sum / 4
    }
    let worst = 0
    const { c0, c1, r0, r1 } = a.hole
    const at = (col: number, row: number) => heights[row * a.grid.cols + col]
    for (let k = 0; k <= c1 - c0; k++) {
      const [x, y] = [block.min.x + k * APRON_CELL_M, block.min.y + k * APRON_CELL_M]
      for (const [col, row, px, py] of [
        [c0 + k, r0, x, block.min.y],
        [c0 + k, r1, x, block.max.y],
        [c0, r0 + k, block.min.x, y],
        [c1, r0 + k, block.max.x, y],
      ] as const) {
        worst = Math.max(worst, Math.abs(at(col, row) - surveyGround(px, py)))
      }
    }
    expect(worst).toBeLessThan(0.05)
  })

  it('carry none of the surveyed features: no pit, dump, pond or road', () => {
    // At the centre of the main pit the survey is ~150 m below the natural ground. The apron's
    // lattice there (hole interior, never drawn) is still the natural ground.
    const col = a.hole.c0 + Math.round(875 / APRON_CELL_M)
    const row = a.hole.r0 + Math.round(1020 / APRON_CELL_M)
    const p = cellCenter(a.grid, col, row)
    expect(trueSurface(p, 'current', SEED)).toBeLessThan(naturalGround(p, SEED) - 100)
    expect(heights[row * a.grid.cols + col]).toBeCloseTo(naturalGround(p, SEED), 3)
  })
})

import { beforeAll, describe, expect, it } from 'vitest'
import type { Orthophoto } from '../domain/types'
import { APRON_PHOTO_REACH_M, apronGrid, apronHeights, buildApronPhoto } from './apron'
import { GRID, SEED } from './fixtures/scenario'
import { SyntheticTerrainProvider } from './SyntheticTerrainProvider'

/*
 * The ground painted around the block has to continue the block's own aerial image, so the edge of
 * the survey shows as the hairline alone. Both images are sampled in strips either side of each
 * edge: the mean colour must match, and the light and dark patches must line up across the edge.
 */

const BAND_M = 50
const SIDE_M = (GRID.cols - 1) * GRID.cellSize
const a = apronGrid(GRID)
const around = buildApronPhoto(a, apronHeights(a, SEED), SEED)
const AROUND_SPAN = SIDE_M + 2 * APRON_PHOTO_REACH_M

/** Mean sRGB of an image over a rectangle of local metres. `at` maps metres to a pixel index. */
function mean(
  photo: Orthophoto,
  at: (m: number) => number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) {
  const sum = [0, 0, 0]
  let n = 0
  for (let j = Math.ceil(at(y0)); j <= Math.floor(at(y1)); j++) {
    for (let i = Math.ceil(at(x0)); i <= Math.floor(at(x1)); i++) {
      const o = (j * photo.width + i) * 4
      for (let k = 0; k < 3; k++) sum[k] += photo.rgba[o + k]
      n++
    }
  }
  return sum.map((v) => v / n)
}

/** Strips BAND_M deep just inside and just outside one edge, between `from` and `to` along it. */
function strips(block: Orthophoto, edge: number, from: number, to: number) {
  const inBlock = (m: number) => (m / SIDE_M) * (block.width - 1)
  const inAround = (m: number) => ((m + APRON_PHOTO_REACH_M) / AROUND_SPAN) * around.width - 0.5
  // Edges: 0 south, 1 north, 2 west, 3 east. [near, far] across the edge, inside then outside.
  const inside = edge % 2 === 0 ? [0, BAND_M] : [SIDE_M - BAND_M, SIDE_M]
  const outside = edge % 2 === 0 ? [-BAND_M, 0] : [SIDE_M, SIDE_M + BAND_M]
  const rect = (across: number[]) =>
    edge < 2
      ? ([from, to, across[0], across[1]] as const)
      : ([across[0], across[1], from, to] as const)
  return {
    inside: mean(block, inBlock, ...rect(inside)),
    outside: mean(around, inAround, ...rect(outside)),
  }
}

describe('ground painted around the survey', () => {
  let block: Orthophoto
  beforeAll(async () => {
    block = (await new SyntheticTerrainProvider().getSurvey('current')).orthophoto!
  }, 120_000)

  it('is a coarse image of the block and the ground around it', () => {
    expect(around.width).toBe(1600)
    expect(around.rgba.length).toBe(1600 * 1600 * 4)
    // 4.8 m per pixel against the block image's 1.6 m.
    expect(AROUND_SPAN / around.width).toBe(4.8)
    expect(around.provenance).toBe('simulated')
  })

  it('matches the mean colour of the block within 50 m either side of every edge', () => {
    for (let edge = 0; edge < 4; edge++) {
      const { inside, outside } = strips(block, edge, 0, SIDE_M)
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(inside[k] - outside[k]), `edge ${edge}, channel ${k}`).toBeLessThan(8)
      }
    }
  })

  it('carries the light and dark patches across every edge', () => {
    // Brightness of 64 m stretches of each strip: inside and outside must rise and fall together.
    const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    const xs: number[] = []
    const ys: number[] = []
    for (let edge = 0; edge < 4; edge++) {
      for (let from = 0; from < SIDE_M; from += 64) {
        const s = strips(block, edge, from, from + 64)
        xs.push(luma(s.inside))
        ys.push(luma(s.outside))
      }
    }
    const avg = (v: number[]) => v.reduce((p, q) => p + q, 0) / v.length
    const [mx, my] = [avg(xs), avg(ys)]
    let sxy = 0
    let sxx = 0
    let syy = 0
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my)
      sxx += (xs[i] - mx) ** 2
      syy += (ys[i] - my) ** 2
    }
    expect(sxy / Math.sqrt(sxx * syy)).toBeGreaterThan(0.6)
  })
})

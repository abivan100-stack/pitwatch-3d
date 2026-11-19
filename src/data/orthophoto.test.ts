import { describe, expect, it } from 'vitest'
import { sampleBilinear } from '../geo/grid'
import { CHANGES, CURRENT_PIT, GRID, PLATEAU_RL, RAMP, ROADS, SEED } from './fixtures/scenario'
import { benchCoordinate, buildOrthophoto, floorStartFor, ORTHOPHOTO_SIZE } from './orthophoto'
import {
  benchDepth,
  buildSurface,
  insidePit,
  naturalField,
  pitSurface,
  pitsOf,
  rampDistance,
} from './synthetic'

const natural = naturalField(GRID, SEED)
const elevations = buildSurface(GRID, 'current', SEED, 0.05, natural)
// The image the provider draws, at its real size: the pit marks are a pixel or two across.
const photo = buildOrthophoto(GRID, elevations, natural, 'current', SEED)
const SIZE = photo.width
const SPAN = (GRID.cols - 1) * GRID.cellSize

/** Pixel colour at local metres (x, y). */
const pixel = (x: number, y: number) => {
  const i = Math.round(((x - GRID.originXY.x) / SPAN) * (SIZE - 1))
  const j = Math.round(((y - GRID.originXY.y) / SPAN) * (SIZE - 1))
  const o = (j * SIZE + i) * 4
  return [photo.rgba[o], photo.rgba[o + 1], photo.rgba[o + 2]]
}
const lum = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
const quantile = (v: number[], q: number) =>
  [...v].sort((a, b) => a - b)[Math.floor(q * (v.length - 1))]

const [mainPit, , encroachment] = pitsOf('current')
const BENCH_STEP = 17
const floorStart = floorStartFor(PLATEAU_RL - CURRENT_PIT.floorRL)

/**
 * Samples of the main pit by where they sit on the wall, every 1.5 m, away from the ramp, the sump
 * and the encroachment lobe: `into` is metres into the bench (face run 0–9, berm 9–17).
 */
const walls = (() => {
  const out = {
    toe: [] as number[][],
    track: [] as number[][],
    flank: [] as number[][],
    sunFace: [] as number[][],
    shadeFace: [] as number[][],
    floorMiddle: [] as number[][],
    floorToe: [] as number[][],
  }
  const sun = { x: -Math.SQRT1_2, y: Math.SQRT1_2 }
  const z = (x: number, y: number) => sampleBilinear(GRID, elevations, { x, y })!
  for (let y = mainPit.box.y0; y < mainPit.box.y1; y += 1.5) {
    for (let x = mainPit.box.x0; x < mainPit.box.x1; x += 1.5) {
      const p = { x, y }
      const edge = insidePit(p, mainPit)
      if (!(edge > 0) || insidePit(p, encroachment) > -20 || rampDistance(p, mainPit) < 25) continue
      if (Math.hypot(x - CHANGES.sump.cx, y - CHANGES.sump.cy) < 40) continue
      const s = benchCoordinate(x, y, edge)
      if (s >= floorStart) {
        if (Math.abs(z(x, y) - CURRENT_PIT.floorRL) > 0.8) continue
        if (s > floorStart + 12) out.floorMiddle.push(pixel(x, y))
        else if (s - floorStart < 2.5) out.floorToe.push(pixel(x, y))
        continue
      }
      if (s > floorStart - BENCH_STEP) continue
      const into = s % BENCH_STEP
      if (into >= 9.4 && into < 10.2) out.toe.push(pixel(x, y))
      else if (into >= 13.2 && into < 14) out.track.push(pixel(x, y))
      else if ((into >= 11.6 && into < 12.2) || (into >= 15.2 && into < 15.8))
        out.flank.push(pixel(x, y))
      else if (into >= 2.5 && into < 6.5) {
        const gx = z(x + 2, y) - z(x - 2, y)
        const gy = z(x, y + 2) - z(x, y - 2)
        const facing = -(gx * sun.x + gy * sun.y) / (Math.hypot(gx, gy) || 1)
        if (facing > 0.5) out.sunFace.push(pixel(x, y))
        else if (facing < -0.5) out.shadeFace.push(pixel(x, y))
      }
    }
  }
  return out
})()

describe('simulated orthophoto', () => {
  it('draws 1280 px over the 2048 m grid, about 1.6 m per pixel, marked simulated', () => {
    // Close range is the shader's detail tile (src/scene/rockDetail.ts), not a bigger image: 2048 px
    // made the first engine result about a quarter slower and the landing model half as slow.
    expect(ORTHOPHOTO_SIZE).toBe(1280)
    expect(SIZE).toBe(ORTHOPHOTO_SIZE)
    expect(SPAN / (SIZE - 1)).toBeCloseTo(1.6, 2)
    expect(photo.rgba.length).toBe(SIZE * SIZE * 4)
    expect(photo.rgba[3]).toBe(255)
    expect(photo.provenance).toBe('simulated')
  })

  it('is reproducible', () => {
    const small = GRID.cols // one pixel per grid column keeps the repeat fast
    const a = buildOrthophoto(GRID, elevations, natural, 'current', SEED, small)
    const b = buildOrthophoto(GRID, elevations, natural, 'current', SEED, small)
    expect(b.rgba).toEqual(a.rgba)
  }, 30_000)

  it('shows the pit as bare ground, redder than it is green', () => {
    const [r, g] = pixel(1130, 1030)
    expect(r).toBeGreaterThan(g)
  })

  it('draws haul roads paler than the scrub around them', () => {
    // The lease-gate road, on the leg from (1150, 300) to (1180, 0).
    const [x, y] = ROADS[ROADS.length - 1]![2]!
    const onRoad = pixel(1159, 210)
    const offRoad = pixel(1159 + 120, 210)
    expect(x).toBeGreaterThan(0)
    expect(y).toBe(0)
    expect(lum(onRoad)).toBeGreaterThan(lum(offRoad))
  })

  it('places berm and toe marks with the same bench coordinate the surface is cut by', () => {
    // Away from the ramp, the benches of the surface are PLATEAU_RL − benchDepth(bench coordinate).
    let checked = 0
    for (let y = mainPit.box.y0; y < mainPit.box.y1; y += 13) {
      for (let x = mainPit.box.x0; x < mainPit.box.x1; x += 13) {
        const p = { x, y }
        const edge = insidePit(p, mainPit)
        if (!(edge > 0) || rampDistance(p, mainPit) < RAMP.width / 2 + 6) continue
        const expected = Math.max(
          CURRENT_PIT.floorRL,
          PLATEAU_RL - benchDepth(Math.max(0, benchCoordinate(x, y, edge))),
        )
        expect(pitSurface(p, mainPit)).toBeCloseTo(expected, 6)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1000)
    expect(benchDepth(floorStart)).toBeCloseTo(PLATEAU_RL - CURRENT_PIT.floorRL, 6)
  })

  it('wears the haul ramp into a pale running surface with darker wheel ruts', () => {
    const ramp = mainPit.ramp!
    const rut: number[] = []
    const running: number[] = []
    for (let k = Math.floor(ramp.points.length * 0.2); k < ramp.points.length * 0.7; k++) {
      const a = ramp.points[k]
      const b = ramp.points[k + 1]
      const l = Math.hypot(b.x - a.x, b.y - a.y)
      const [nx, ny] = [-(b.y - a.y) / l, (b.x - a.x) / l]
      const at = (d: number) => lum(pixel(a.x + d * nx, a.y + d * ny))
      for (const side of [-1, 1]) {
        rut.push(at(side * 3.6), at(side * 9.2))
        running.push(at(side * 6.4), at(side * 0.8))
      }
    }
    expect(RAMP.width / 2).toBeGreaterThan(9.2)
    expect(mean(running) - mean(rut)).toBeGreaterThan(10)
  })

  it('gives each berm a light wear track and a damp strip at the toe of the face above', () => {
    expect(walls.track.length).toBeGreaterThan(500)
    expect(walls.toe.length).toBeGreaterThan(500)
    // Measured on the old image: track 130, toe 80, toe blue/red 0.49 (face rock reached the toe).
    expect(mean(walls.track.map(lum)) - mean(walls.toe.map(lum))).toBeGreaterThan(65)
    expect(mean(walls.toe.map(([r, , b]) => b / r))).toBeGreaterThan(0.62)
  })

  it('colours walls by aspect: redder facing the sun, greyer in shade', () => {
    const redness = (v: number[][]) => mean(v.map(([r, g]) => r / g))
    expect(walls.sunFace.length).toBeGreaterThan(500)
    expect(walls.shadeFace.length).toBeGreaterThan(500)
    expect(redness(walls.sunFace) - redness(walls.shadeFace)).toBeGreaterThan(0.05)
  })

  it('varies the floor with wet and dry patches, and spreads grey spoil at the toes', () => {
    const floor = walls.floorMiddle.map(lum)
    expect(floor.length).toBeGreaterThan(2000)
    expect(quantile(floor, 0.9) - quantile(floor, 0.1)).toBeGreaterThan(30)
    const greyness = (v: number[][]) => mean(v.map(([r, , b]) => b / r))
    expect(greyness(walls.floorToe) - greyness(walls.floorMiddle)).toBeGreaterThan(0.03)
  })

  it('draws the sump as standing water with a paler line at its edge, where it was', () => {
    const { cx, cy, r } = CHANGES.sump
    const edge: number[] = []
    const water: number[] = []
    const floor: number[] = []
    // The east half, clear of the ramp's foot to the west.
    for (let t = -1.2; t <= 1.2; t += 0.05) {
      const ring = (d: number) => lum(pixel(cx + d * Math.cos(t), cy + d * Math.sin(t)))
      edge.push(ring(r - 0.7))
      water.push(ring(6))
      floor.push(ring(r + 15))
    }
    // The water is still where the elevations put the sump: below the floor, darker than it.
    expect(sampleBilinear(GRID, elevations, { x: cx, y: cy })!).toBeLessThan(
      CURRENT_PIT.floorRL - 1,
    )
    expect(mean(water)).toBeLessThan(mean(floor) - 20)
    expect(mean(edge) - mean(water)).toBeGreaterThan(15)
  })
})

describe('haul ramp', () => {
  const pit = pitsOf('current')[0]
  const ramp = pit.ramp!

  it('leaves the rim where the haul road arrives and reaches the floor', () => {
    expect(ramp.depth[0]).toBe(0)
    expect(ramp.depth[ramp.depth.length - 1]).toBeCloseTo(PLATEAU_RL - CURRENT_PIT.floorRL)
    expect(
      Math.hypot(ramp.points[0].x - RAMP.start.x, ramp.points[0].y - RAMP.start.y),
    ).toBeLessThan(80)
  })

  it('is a road at its own level across the benches, descending at the design grade', () => {
    const k = Math.floor(ramp.points.length / 2)
    expect(insidePit(ramp.points[k], pit)).toBeGreaterThan(0)
    expect(pitSurface(ramp.points[k], pit)).toBeCloseTo(PLATEAU_RL - ramp.depth[k], 0)
    let run = 0
    for (let j = 1; j <= k; j++) {
      run += Math.hypot(
        ramp.points[j].x - ramp.points[j - 1].x,
        ramp.points[j].y - ramp.points[j - 1].y,
      )
    }
    expect(ramp.depth[k] / run).toBeCloseTo(RAMP.grade, 2)
  })
})

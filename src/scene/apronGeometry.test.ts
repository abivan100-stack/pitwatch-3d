import type { Object3D } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { apronGrid, apronHeights } from '../data/apron'
import { GRID, SEED } from '../data/fixtures/scenario'
import type { TerrainSurvey } from '../domain/types'
import { pickGround, surveyEdgeLine } from './overlayGeometry'
import { BASE_RL, apronDropAt, buildApronArrays, buildTerrainArrays } from './terrainGeometry'

const a = apronGrid(GRID)
const apron = buildApronArrays(a, apronHeights(a, SEED))
const HALF = 1024 // half the block, scene units

describe('apron geometry', () => {
  it('leaves out every cell of the surveyed grid: no triangle stands inside the block', () => {
    const { positions, index } = apron
    let inside = 0
    for (let i = 0; i < index.length; i += 3) {
      // Triangle centre, scene x/z. The block is the open square (-1024, 1024) on both axes.
      let [x, z] = [0, 0]
      for (let k = 0; k < 3; k++) {
        x += positions[index[i + k] * 3] / 3
        z += positions[index[i + k] * 3 + 2] / 3
      }
      if (Math.abs(x) < HALF && Math.abs(z) < HALF) inside++
    }
    expect(inside).toBe(0)
  })

  it('adds no more than a quarter of the block surface triangles', () => {
    const block = buildTerrainArrays(GRID, new Float32Array(GRID.cols * GRID.rows)).index.length / 3
    const added = apron.index.length / 3
    expect(added / block).toBeLessThanOrEqual(0.25)
    // Pinned, so a change to the lattice or reach is a visible choice: 118,816 against 524,288.
    expect(added).toBe(2 * (252 * 252 - 64 * 64))
  })

  it('faces upward, stays finite and is coloured from the apron ramp', () => {
    const { positions, colors, index } = apron
    expect(positions.every(Number.isFinite)).toBe(true)
    expect(colors.every((c) => c >= 0 && c <= 1)).toBe(true)
    for (let i = 0; i < index.length; i += 3) {
      const [p, q, r] = [0, 1, 2].map((k) => index[i + k] * 3)
      const ux = positions[q] - positions[p]
      const uz = positions[q + 2] - positions[p + 2]
      const vx = positions[r] - positions[p]
      const vz = positions[r + 2] - positions[p + 2]
      expect(uz * vx - ux * vz).toBeGreaterThan(0) // the y component of the cross product
    }
  })

  it('shares the block edge: its inner vertices sit on the block outline', () => {
    const { positions, index } = apron
    const onEdge = new Set<number>()
    for (const v of index) {
      const [x, z] = [positions[v * 3], positions[v * 3 + 2]]
      const outline = Math.max(Math.abs(x), Math.abs(z))
      if (outline === HALF) onEdge.add(v)
    }
    // 64 cells a side, so 65 vertices a side minus shared corners: 4 * 64.
    expect(onEdge.size).toBe(4 * 64)
  })
})

describe('apron drop', () => {
  it('is the full drop at the block edge, none from the ramp on, and nothing with no drop', () => {
    expect(apronDropAt(0, 45, 400)).toBe(45)
    expect(apronDropAt(400, 45, 400)).toBe(0)
    expect(apronDropAt(1000, 45, 400)).toBe(0)
    expect(apronDropAt(0, 0, 400)).toBe(0)
    expect(apronDropAt(200, 0, 400)).toBe(0)
  })

  it('falls monotonically between the edge and the ramp', () => {
    let prev = apronDropAt(0, 45, 400)
    for (let d = 10; d <= 400; d += 10) {
      const v = apronDropAt(d, 45, 400)
      expect(v).toBeLessThanOrEqual(prev)
      prev = v
    }
    expect(apronDropAt(200, 45, 400)).toBeCloseTo(22.5, 6) // smoothstep is half way at the middle
  })
})

describe('clicks on the apron', () => {
  const ground = { material: { depthTest: true } } as unknown as Object3D
  const badge = { material: { depthTest: false } } as unknown as Object3D
  const click = (delta: number, ...objects: Object3D[]) => {
    const stopPropagation = vi.fn()
    const onPick = vi.fn()
    const point = { x: 1500, y: 0, z: 0 }
    pickGround(
      { delta, point, intersections: objects.map((object) => ({ object })), stopPropagation },
      onPick,
    )
    return { stopPropagation, onPick, point }
  }

  it('are taken and read, so the Inspector reports the point outside the survey', () => {
    const { stopPropagation, onPick, point } = click(0, ground)
    expect(stopPropagation).toHaveBeenCalledOnce()
    expect(onPick).toHaveBeenCalledWith(point)
  })

  it('leave a drag to the camera and a badge drawn over everything to the badge', () => {
    for (const r of [click(9, ground), click(0, ground, badge)]) {
      expect(r.stopPropagation).not.toHaveBeenCalled()
      expect(r.onPick).not.toHaveBeenCalled()
    }
  })
})

describe('survey edge line', () => {
  const survey = {
    grid: GRID,
    elevations: new Float32Array(GRID.cols * GRID.rows).fill(420),
  } as TerrainSurvey

  it('runs once round the edge of the surveyed grid, just above the ground', () => {
    const pts = surveyEdgeLine(survey, 1)
    // Every point is on the block's outline (scene x or z at +/-1024) and 6 m above the ground.
    for (const [x, y, z] of pts) {
      expect(Math.max(Math.abs(x), Math.abs(z))).toBeCloseTo(HALF, 6)
      expect(y).toBeCloseTo(420 - BASE_RL + 6, 6)
    }
    // Four sides of 2048 m, a point every 16 m, and it closes on its start.
    expect(pts).toHaveLength(4 * (2048 / 16 + 1))
    expect(pts[pts.length - 1]).toEqual(pts[0])
  })
})

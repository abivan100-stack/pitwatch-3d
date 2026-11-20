import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { evaluate } from '../compliance/engine'
import { largestPitZone } from '../compliance/zone'
import { SyntheticTerrainProvider } from '../data/SyntheticTerrainProvider'
import type { ComplianceFinding, GridSpec, TerrainSurvey } from '../domain/types'
import { cellAt, centerOfIndex, sampleBilinear } from '../geo/grid'
import { centroidOf } from '../geo/polygon'
import {
  drawnOnTop,
  FINDING_AIM_LIFT,
  findingAnchor,
  findingView,
  groundRing,
  PIN_HEIGHT,
  ringRadius,
} from './overlayGeometry'
import { hexToRgb, RAMP, rampAt, rampGradient, srgbToLinear } from './palette'
import {
  easeInOutCubic,
  easeOutCubic,
  FLIGHT_MAX_MS,
  FLIGHT_MIN_MS,
  flightMs,
  focusPose,
  headingOf,
  metresPerPixel,
  northUp,
  presetPose,
  rescalePose,
  scaleBar,
  type Pose,
  type V3,
} from './presets'
import {
  BASE_RL,
  buildSkirtArrays,
  buildTerrainArrays,
  elevationRange,
  elevationScale,
  fromScene,
  SKIRT_RL,
  toScene,
} from './terrainGeometry'

const grid: GridSpec = { cols: 3, rows: 2, cellSize: 8, originXY: { x: 0, y: 0 } }
const elev = Float32Array.from([400, 410, 420, 430, 440, 450])

describe('palette', () => {
  it('interpolates the ramp and clamps at the ends', () => {
    expect(rampAt(0)).toEqual(hexToRgb(RAMP[0][1]))
    expect(rampAt(-1)).toEqual(rampAt(0))
    expect(rampAt(2)).toEqual(hexToRgb(RAMP[RAMP.length - 1][1]))
    const mid = rampAt(RAMP[1][0] / 2)
    const [a, b] = [hexToRgb(RAMP[0][1]), hexToRgb(RAMP[1][1])]
    expect(mid[0]).toBeCloseTo((a[0] + b[0]) / 2)
  })

  it('converts sRGB to linear light', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(1)).toBeCloseTo(1)
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3)
  })

  it('builds a CSS gradient from the same stops', () => {
    expect(rampGradient()).toMatch(/^linear-gradient\(to right, #2f4b66 0%, .* #8f4f3e 100%\)$/)
  })
})

describe('terrain geometry', () => {
  it('maps local metres and RL to centred, Y-up scene coordinates', () => {
    // Grid centre is (8, 4). North (+Y) becomes −z.
    expect(toScene(grid, { x: 16, y: 8 }, 425)).toEqual([8, 25, -4])
    expect(fromScene(grid, 8, -4)).toEqual({ x: 16, y: 8 })
  })

  it('creates one vertex per cell and two upward triangles per square', () => {
    const { positions, colors, uvs, index } = buildTerrainArrays(grid, elev)
    expect(positions.length).toBe(6 * 3)
    expect(Array.from(uvs)).toEqual([0, 0, 0.5, 0, 1, 0, 0, 1, 0.5, 1, 1, 1])
    expect(colors.length).toBe(6 * 3)
    expect(index.length).toBe(2 * 1 * 6)
    expect(Array.from(positions.slice(0, 3))).toEqual([-8, 400 - BASE_RL, 4])

    // Every triangle's normal points up (+y).
    for (let k = 0; k < index.length; k += 3) {
      const [a, b, c] = [index[k], index[k + 1], index[k + 2]].map((i) => [
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ])
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      expect(u[2] * v[0] - u[0] * v[2]).toBeGreaterThan(0)
    }
  })

  it('tints the lowest cell with the bottom of the ramp', () => {
    const { colors } = buildTerrainArrays(grid, elev)
    expect(colors[0]).toBeCloseTo(srgbToLinear(hexToRgb(RAMP[0][1])[0]))
  })

  it('spreads tint colours by rank so crowded heights get more of the ramp', () => {
    // Most cells at 420–430 (a plateau), a few deep ones: the plateau must not be one colour.
    const values = Float32Array.from([
      ...Array.from({ length: 90 }, (_, i) => 420 + i / 9),
      ...Array.from({ length: 10 }, (_, i) => 300 + i * 10),
    ])
    const s = elevationScale(values)
    expect(s.t(s.min)).toBe(0)
    expect(s.t(s.max)).toBe(1)
    expect(s.t(430) - s.t(420)).toBeGreaterThan(0.4) // a linear ramp gives 0.08
    for (const t of [0.1, 0.5, 0.9]) expect(s.t(s.at(t))).toBeCloseTo(t, 3)
  })

  it('drops the block sides from every edge cell to the skirt level', () => {
    const { positions, tops, index } = buildSkirtArrays(grid, elev)
    expect(tops[0]).toBe(400)
    expect(tops[1]).toBe(400)
    // Perimeter strips: 3 + 2 + 3 + 2 points, two vertices each.
    expect(positions.length / 3).toBe(20)
    expect(index.length).toBe((2 + 1 + 2 + 1) * 6)
    expect(positions[4]).toBe(SKIRT_RL - BASE_RL)
  })

  it('finds the elevation range', () => {
    expect(elevationRange(elev)).toEqual({ min: 400, max: 450 })
  })
})

describe('camera presets', () => {
  const pit = { x: -24, y: -6 }

  it('aims every preset at the pit', () => {
    for (const kind of ['oblique', 'top', 'pit'] as const) {
      const { target } = presetPose(kind, pit, -40)
      expect([target[0], target[2]]).toEqual([pit.x, pit.y])
    }
    expect(presetPose('top', pit, -40).position[1]).toBeGreaterThan(3000)
  })

  it('reads headings clockwise from north', () => {
    expect(headingOf([0, 10, 10], [0, 0, 0])).toBeCloseTo(0) // camera south, looking north
    expect(headingOf([-10, 10, 0], [0, 0, 0])).toBeCloseTo(90) // looking east
    expect(headingOf([0, 10, -10], [0, 0, 0])).toBeCloseTo(180)
  })

  it('turns a view to north-up without changing distance or height', () => {
    const { position } = northUp([300, 500, 400], [0, 0, 0])
    expect(position).toEqual([0, 500, 500])
    expect(headingOf(position, [0, 0, 0])).toBeCloseTo(0)
  })

  it('picks a round scale-bar length that fits', () => {
    expect(metresPerPixel(1000, 90, 2000)).toBeCloseTo(1)
    expect(scaleBar(1)).toEqual({ metres: 100, px: 100 })
    expect(scaleBar(3)).toEqual({ metres: 200, px: 200 / 3 })
  })
})

describe('focus view', () => {
  it('looks at the point from the south-east, above it', () => {
    const { position, target } = focusPose([10, 20, 30])
    expect(target).toEqual([10, 20, 30])
    expect(position[0]).toBeGreaterThan(10)
    expect(position[1]).toBeGreaterThan(20)
    expect(position[2]).toBeGreaterThan(30)
    expect(headingOf(position, target)).toBeGreaterThan(270) // looking north-west
  })
})

describe('finding ring', () => {
  const survey = { grid, elevations: elev } as unknown as TerrainSurvey

  it('is a closed loop on the ground, the stated distance from its centre in plan', () => {
    const ring = groundRing(survey, { x: 12, y: 4 }, 3, 1.5)
    expect(ring).toHaveLength(49)
    expect(ring[48]).toEqual(ring[0])
    const [cx, , cz] = toScene(grid, { x: 12, y: 4 }, 0)
    for (const [x, y, z] of ring) {
      expect(Math.hypot(x - cx, z - cz)).toBeCloseTo(3, 6)
      // On the exaggerated surface, a little above it (heights run 400 to 450 here).
      expect(y).toBeGreaterThan((400 - BASE_RL) * 1.5)
      expect(y).toBeLessThan((450 - BASE_RL) * 1.5 + 4)
    }
  })

  it('sizes the ring to the finding, kept readable for the smallest and the largest', () => {
    expect(ringRadius(16)).toBe(30)
    expect(ringRadius(3000)).toBeCloseTo(Math.sqrt(3000 / Math.PI) * 1.2, 6)
    expect(ringRadius(1e6)).toBe(70)
  })
})

describe('drawnOnTop', () => {
  it('is true only for an object whose material skips the depth test', () => {
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }))
    const ground = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial())
    const multi = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshBasicMaterial({ depthTest: false }),
    ])
    expect(drawnOnTop(badge)).toBe(true)
    expect(drawnOnTop(ground)).toBe(false)
    expect(drawnOnTop(multi)).toBe(false)
    expect(drawnOnTop(new THREE.Group())).toBe(false)
  })
})

describe('rescalePose', () => {
  const pit = { x: 880, y: -1020 }
  const close = (a: Pose, b: Pose) => {
    for (const k of ['position', 'target'] as const)
      a[k].forEach((v, i) => expect(v).toBeCloseTo(b[k][i], 9))
  }

  it('turns a preset at one exaggeration into the same preset at another', () => {
    const floorRL = 240 // approved floor; BASE_RL is the zero of scene y
    for (const kind of ['oblique', 'top', 'pit', 'intro'] as const) {
      const at = (ex: number) => presetPose(kind, pit, (floorRL - BASE_RL) * ex)
      close(rescalePose(at(1.5), 3 / 1.5), at(3))
      close(rescalePose(at(3), 1 / 3), at(1))
    }
  })

  it('does the same for a focus on a ground point', () => {
    const at = (ex: number) => focusPose([300, (310 - BASE_RL) * ex, -900])
    close(rescalePose(at(1.5), 2), at(3))
  })

  it('rescales every point of a flight when it rescales both ends', () => {
    const from = presetPose('oblique', pit, -240)
    const to = presetPose('pit', pit, -240)
    const mid = (a: Pose, b: Pose, e: number): Pose => {
      const m = (u: V3, v: V3): V3 => [0, 1, 2].map((i) => u[i] + (v[i] - u[i]) * e) as V3
      return { position: m(a.position, b.position), target: m(a.target, b.target) }
    }
    for (const e of [0, 0.3, 0.5, 1]) {
      close(rescalePose(mid(from, to, e), 2), mid(rescalePose(from, 2), rescalePose(to, 2), e))
    }
  })
})

describe('rescalePose with a lifted aim', () => {
  it('keeps a finding view aimed half way up the pin at any exaggeration', () => {
    const at = (ex: number) => focusPose([300, (310 - BASE_RL) * ex + FINDING_AIM_LIFT, -900])
    const close = (a: Pose, b: Pose) => {
      for (const k of ['position', 'target'] as const)
        a[k].forEach((v, i) => expect(v).toBeCloseTo(b[k][i], 9))
    }
    close(rescalePose(at(1.5), 2, FINDING_AIM_LIFT), at(3))
    close(rescalePose(at(3), 1 / 3, FINDING_AIM_LIFT), at(1))
  })
})

describe('finding flights', () => {
  let current: TerrainSurvey
  let findings: ComplianceFinding[]
  let pit: { x: number; y: number }
  let floorRL: number

  beforeAll(async () => {
    const p = new SyntheticTerrainProvider()
    const [baseline, cur, limits] = await Promise.all([
      p.getSurvey('baseline'),
      p.getSurvey('current'),
      p.getLimits(),
    ])
    current = cur
    findings = evaluate(baseline, current, limits).findings
    const zone = largestPitZone(limits.pitZones)!
    const [x, , z] = toScene(current.grid, centroidOf(zone.polygon), zone.approvedFloorElevation)
    pit = { x, y: z }
    floorRL = zone.approvedFloorElevation
  }, 60_000)

  const cellOf = (p: { x: number; y: number }) => {
    const rc = cellAt(current.grid, p)!
    return rc.row * current.grid.cols + rc.col
  }

  it('aims each of the five findings at one of its own cells, nearest its centroid', () => {
    const anchors = Object.fromEntries(
      findings.map((f) => [f.id, findingAnchor(current.grid, f)] as const),
    )
    // Measured: every centroid lies in its own finding, and its anchor is under 2 m from it.
    expect(anchors).toEqual({
      'R1-1': { x: 1404, y: 1032 },
      'R2-1': { x: 880, y: 1020 },
      'R1-2': { x: 1372, y: 1028 },
      'R3-1': { x: 1520, y: 480 },
      'R1-3': { x: 956, y: 1504 },
    })
    for (const f of findings) {
      const a = anchors[f.id]
      expect(f.cells).toContain(cellOf(a))
      const d = (p: { x: number; y: number }) => Math.hypot(p.x - f.centroid.x, p.y - f.centroid.y)
      for (const i of f.cells) expect(d(a)).toBeLessThanOrEqual(d(centerOfIndex(current.grid, i)))
      // The reported figures are not moved by the anchor: the centroid is still the plain mean.
      const mean = f.cells.reduce(
        (m, i) => {
          const c = centerOfIndex(current.grid, i)
          return { x: m.x + c.x / f.cells.length, y: m.y + c.y / f.cells.length }
        },
        { x: 0, y: 0 },
      )
      expect(f.centroid.x).toBeCloseTo(mean.x, 6)
      expect(f.centroid.y).toBeCloseTo(mean.y, 6)
      expect(f.areaM2).toBe(f.cells.length * current.grid.cellSize ** 2)
    }
  })

  it('picks a cell of the finding when its mean falls outside it', () => {
    // The four corners of a 3 × 3 grid: their mean is the centre cell, which is not one of them.
    const grid: GridSpec = { cols: 3, rows: 3, cellSize: 4, originXY: { x: 0, y: 0 } }
    const ring = { cells: [0, 2, 6, 8], centroid: { x: 4, y: 4 } }
    const a = findingAnchor(grid, ring)
    const rc = cellAt(grid, a)!
    expect(ring.cells).toContain(rc.row * grid.cols + rc.col)
    expect(ring.cells).not.toContain(4) // the centre cell, where the mean is
  })

  it('aims half way up the pin above the anchor, from the usual 560 m', () => {
    for (const ex of [1, 1.5, 3]) {
      for (const f of findings) {
        const a = findingAnchor(current.grid, f)
        const z = sampleBilinear(current.grid, current.elevations, a)!
        const [x, , sz] = toScene(current.grid, a, z)
        const view = findingView(current, f, ex)
        expect(view.target[0]).toBeCloseTo(x, 9)
        expect(view.target[2]).toBeCloseTo(sz, 9)
        expect(view.target[1]).toBeCloseTo((z - BASE_RL) * ex + PIN_HEIGHT / 2, 9)
        expect(view).toEqual(focusPose(view.target))
      }
    }
  })

  it('lands within 900 ms from anywhere, and within 700 ms between neighbouring findings', () => {
    const ex = 1.5
    const floorY = (floorRL - BASE_RL) * ex
    const views = findings.map((f) => findingView(current, f, ex))
    const starts = [
      ...views,
      ...(['oblique', 'top', 'pit', 'intro'] as const).map((k) => presetPose(k, pit, floorY)),
    ]
    for (const to of views) {
      for (const from of starts) {
        const ms = flightMs(from, to)
        expect(ms).toBeGreaterThanOrEqual(FLIGHT_MIN_MS)
        expect(ms).toBeLessThanOrEqual(FLIGHT_MAX_MS)
      }
    }
    expect(FLIGHT_MAX_MS).toBeLessThan(1000)
    const byId = (id: string) => views[findings.findIndex((f) => f.id === id)]
    // R1-1 and R1-2 are the same pushback, 34 m apart.
    expect(flightMs(byId('R1-1'), byId('R1-2'))).toBeLessThanOrEqual(700)
    expect(flightMs(byId('R1-2'), byId('R1-1'))).toBeLessThanOrEqual(700)
    // A longer move takes longer, up to the cap.
    expect(flightMs(byId('R1-3'), byId('R3-1'))).toBeGreaterThan(
      flightMs(byId('R1-1'), byId('R1-2')),
    )
    expect(flightMs(presetPose('intro', pit, floorY), byId('R3-1'))).toBe(FLIGHT_MAX_MS)
  })

  it('covers at least 15% of the way in the first 100 ms of any finding flight', () => {
    for (let ms = FLIGHT_MIN_MS; ms <= FLIGHT_MAX_MS; ms += 10) {
      expect(easeOutCubic(100 / ms)).toBeGreaterThanOrEqual(0.15)
    }
    // The old flight: 1.3 s of ease-in-out moved the camera 0.2% of the way in its first 100 ms.
    expect(easeInOutCubic(100 / 1300)).toBeLessThan(0.01)
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })
})

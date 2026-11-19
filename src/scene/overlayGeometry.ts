import type { Object3D } from 'three'
import type { ComplianceFinding, GridSpec, Polygon, TerrainSurvey, Vec2 } from '../domain/types'
import { centerOfIndex, sampleBilinear } from '../geo/grid'
import { focusPose, type Pose } from './presets'
import { BASE_RL, toScene } from './terrainGeometry'

export type V3 = [number, number, number]

/** Height above the ground that lines float at, so they are not buried in relief. */
const LIFT = 6

/** Scene position of a plan point, `lift` metres above the (exaggerated) surface. */
export function onGround(survey: TerrainSurvey, p: Vec2, ex: number, lift = LIFT): V3 {
  const z = sampleBilinear(survey.grid, survey.elevations, p) ?? BASE_RL
  const [x, , sz] = toScene(survey.grid, p, z)
  return [x, (z - BASE_RL) * ex + lift, sz]
}

/** Height of a finding pin's stick, scene units; its badge sits on top. Not exaggerated. */
export const PIN_HEIGHT = 90

/** A finding view aims this far above the ground, half way up the pin, so the pin is centred. */
export const FINDING_AIM_LIFT = PIN_HEIGHT / 2

/**
 * Where the camera looks for a finding: the finding's own cell nearest its centroid. The mean of
 * an irregular finding's cells can lie outside them; this only moves the camera, so the reported
 * centroid and every figure built on it stay as they are.
 */
export function findingAnchor(
  grid: GridSpec,
  f: Pick<ComplianceFinding, 'cells' | 'centroid'>,
): Vec2 {
  let best = centerOfIndex(grid, f.cells[0])
  let bestD = Infinity
  for (const i of f.cells) {
    const p = centerOfIndex(grid, i)
    const d = Math.hypot(p.x - f.centroid.x, p.y - f.centroid.y)
    if (d < bestD) [best, bestD] = [p, d]
  }
  return best
}

/** The camera pose that frames a finding: its anchor, aimed half way up its pin. */
export function findingView(
  survey: TerrainSurvey,
  f: Pick<ComplianceFinding, 'cells' | 'centroid'>,
  ex: number,
): Pose {
  return focusPose(onGround(survey, findingAnchor(survey.grid, f), ex, FINDING_AIM_LIFT))
}

/** Polyline along a polygon outline, a few metres above the ground, a point every ~16 m. */
export function leaseLine(survey: TerrainSurvey, lease: Polygon, ex: number) {
  const pts: V3[] = []
  for (let k = 0; k < lease.length; k++) {
    const a = lease[k]
    const b = lease[(k + 1) % lease.length]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16))
    for (let s = 0; s <= steps; s++) {
      const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }
      pts.push(onGround(survey, p, ex))
    }
  }
  return pts
}

/**
 * True for an object drawn over everything (its material skips the depth test), such as a
 * finding badge. It shows through the terrain, so it must also win a click over the terrain.
 */
export function drawnOnTop(o: Object3D): boolean {
  const m = (o as Object3D & { material?: { depthTest?: boolean } | unknown[] }).material
  return !!m && !Array.isArray(m) && m.depthTest === false
}

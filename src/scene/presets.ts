import type { Vec2 } from '../domain/types'

/*
 * Camera poses in scene units (see terrainGeometry.ts for the axes).
 * Pure maths so the presets can be tested without three.js.
 */

export type ViewPreset = 'oblique' | 'top' | 'pit'
export type ViewRequest = ViewPreset | 'north' | 'intro'

export type V3 = [number, number, number]

export interface Pose {
  position: V3
  target: V3
}

/**
 * @param pit       pit centre in scene x/z
 * @param floorY    pit floor height in scene y, already exaggerated
 */
export function presetPose(kind: ViewPreset | 'intro', pit: Vec2, floorY: number): Pose {
  const t: V3 = [pit.x, floorY * 0.5, pit.y]
  const off: Record<ViewPreset | 'intro', V3> = {
    oblique: [600, 1560, 1930],
    top: [0, 3050, 1],
    pit: [560, 900, 1120],
    intro: [0, 4700, 1400],
  }
  const o = off[kind]
  return { position: [t[0] + o[0], t[1] + o[1], t[2] + o[2]], target: t }
}

/**
 * The same pose after the vertical scale is multiplied by `k`: the aim point stays on the same
 * ground feature (its height scales) and the camera keeps its height above the aim point. Linear
 * in the pose, so rescaling both ends of a flight also rescales every point between them.
 * @param lift height of the aim point above that ground, which does not scale (a finding view
 *             aims at a pin, and pins keep their height at any exaggeration)
 */
export function rescalePose(p: Pose, k: number, lift = 0): Pose {
  const ty = (p.target[1] - lift) * k + lift
  return {
    position: [p.position[0], p.position[1] + ty - p.target[1], p.position[2]],
    target: [p.target[0], ty, p.target[2]],
  }
}

/** Close oblique view of a ground point (scene units), looking from the south-east. */
export function focusPose(ground: V3, distance = 560): Pose {
  const o: V3 = [0.4, 0.58, 0.71]
  return {
    position: [
      ground[0] + o[0] * distance,
      ground[1] + o[1] * distance,
      ground[2] + o[2] * distance,
    ],
    target: ground,
  }
}

/**
 * Same distance and tilt, turned so the camera looks due north (towards −z).
 */
export function northUp(position: V3, target: V3): Pose {
  const dx = position[0] - target[0]
  const dz = position[2] - target[2]
  const flat = Math.hypot(dx, dz)
  return { position: [target[0], position[1], target[2] + flat], target }
}

/** Compass heading the camera looks along, degrees clockwise from north. */
export function headingOf(position: V3, target: V3): number {
  const dx = target[0] - position[0]
  const dz = target[2] - position[2]
  if (dx === 0 && dz === 0) return 0
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI
  return (deg + 360) % 360
}

/** Ground metres covered by one screen pixel at the target distance. */
export function metresPerPixel(distance: number, fovDeg: number, viewportPx: number): number {
  return (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / viewportPx
}

const NICE = [5, 10, 20, 50, 100, 200, 500, 1000, 2000]

/** Largest round length that fits in `maxPx`, and its width in pixels. */
export function scaleBar(mpp: number, maxPx = 120): { metres: number; px: number } {
  let metres = NICE[0]
  for (const n of NICE) if (n / mpp <= maxPx) metres = n
  return { metres, px: metres / mpp }
}

/** Smoothstep-like ease for the preset camera flights. */
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** Decelerating ease for finding flights: the camera moves at once and settles gently. */
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/** Shortest finding flight, ms. */
export const FLIGHT_MIN_MS = 600
/**
 * Longest finding flight, ms. Below 1 s so the move still ends within 1 s of the click once the
 * frame that starts it has run.
 */
export const FLIGHT_MAX_MS = 900

/**
 * Duration of a finding flight: 600 ms plus 1 ms per 5 m that the camera or its aim point
 * travels, whichever moves further, up to 900 ms.
 */
export function flightMs(from: Pose, to: Pose): number {
  const d = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const travel = Math.max(d(from.position, to.position), d(from.target, to.target))
  return Math.min(FLIGHT_MAX_MS, FLIGHT_MIN_MS + travel / 5)
}

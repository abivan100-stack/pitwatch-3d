import type { GridSpec, Measurement, Vec2, Vec3 } from '../domain/types'
import { sampleBilinear } from './grid'

/** Straight-line measurement between two picked points. */
export function measure(a: Vec3, b: Vec3): Measurement {
  const horizontalDistance = Math.hypot(b.x - a.x, b.y - a.y)
  const dz = b.z - a.z
  return {
    a,
    b,
    horizontalDistance,
    slopeDistance: Math.hypot(horizontalDistance, dz),
    dz,
    provenance: 'derived',
  }
}

/** Measurement between two plan points, reading their elevations from a surface grid. */
export function measureOnSurface(
  g: GridSpec,
  elevations: Float32Array,
  a: Vec2,
  b: Vec2,
): Measurement | null {
  const za = sampleBilinear(g, elevations, a)
  const zb = sampleBilinear(g, elevations, b)
  return za === null || zb === null ? null : measure({ ...a, z: za }, { ...b, z: zb })
}

/**
 * 1σ of the slope distance S = √(H² + dz²), propagated to first order from the horizontal
 * distance error σ_H and the elevation-change error σ_dz: each term is weighted by its share of
 * the line, so a flat line carries σ_H and a vertical one σ_dz.
 */
export function slopeDistanceSigma(m: Measurement, sigmaH: number, sigmaDz: number): number {
  const s = m.slopeDistance
  if (s === 0) return Math.max(sigmaH, sigmaDz)
  return Math.hypot((m.horizontalDistance / s) * sigmaH, (m.dz / s) * sigmaDz)
}

/**
 * 1σ of the grade dz / H as a fraction (×100 for percent), propagated to first order from σ_H
 * and σ_dz. Null when the two points share a plan position, where the grade is undefined.
 */
export function gradeSigma(m: Measurement, sigmaH: number, sigmaDz: number): number | null {
  const h = m.horizontalDistance
  if (h === 0) return null
  return Math.hypot(sigmaDz / h, (m.dz * sigmaH) / (h * h))
}

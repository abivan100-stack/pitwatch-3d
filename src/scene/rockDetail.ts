import * as THREE from 'three'
import { hash2 } from '../data/rng'

/*
 * Close-range detail for the terrain surface. The aerial image is about 1.6 m per pixel, so near the
 * camera it blurs and the scene has nothing to replace it. This tile carries rock jointing (R),
 * a field the shader turns into gullies (G), fine grain for flat ground (B) and broad patches (A)
 * that decide where the walls are gullied and where they are sound. The surface shader samples it
 * in world metres on the existing mesh: no new geometry, and no elevation changes.
 *
 * Flat ground reads the tile from above. A steep face reads it on a vertical plane along the wall
 * (along-contour metres by elevation), so jointing stays blocky instead of being stretched down
 * the slope, and gullies, which run down the tile's v axis, run down the fall line.
 *
 * The tile is periodic, so it repeats. Every sampling the shader makes covers DETAIL_TILE_M metres
 * per tile, so nothing repeats sooner than that across the pit.
 */

/** Ground covered by one tile, metres, in every sampling the shader makes of it. */
export const DETAIL_TILE_M = 256
/** Texels per side: 0.5 m per texel. */
const DETAIL_SIZE = 512
/** Half-width of a gully channel in the G field (a band around its mid value). */
const GULLY_WIDTH = 0.1

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** How much of a gully a G value is: 1 at the channel's centre line, 0 beyond its width. */
const gullyChannel = (g: number) => 1 - smoothstep(0, GULLY_WIDTH, Math.abs(g - 0.5))

/**
 * Value noise on an n × n tile that wraps at its edges, with a lattice point every `cellX` texels
 * across and `cellY` down (n must be a multiple of both). `smooth` false keeps the facets of plain
 * bilinear blending.
 */
function tileNoise(
  n: number,
  cellX: number,
  cellY: number,
  seed: number,
  smooth = true,
): Float32Array {
  const mx = n / cellX
  const my = n / cellY
  const lattice = new Float32Array(mx * my)
  for (let y = 0; y < my; y++) for (let x = 0; x < mx; x++) lattice[y * mx + x] = hash2(x, y, seed)
  const ease = (t: number) => (smooth ? t * t * (3 - 2 * t) : t)
  // The lattice columns and blend weight of every texel column, worked out once for all rows.
  const c0 = new Int32Array(n)
  const c1 = new Int32Array(n)
  const tx = new Float64Array(n)
  for (let x = 0; x < n; x++) {
    const x0 = Math.floor(x / cellX)
    c0[x] = x0 % mx
    c1[x] = (x0 + 1) % mx
    tx[x] = ease(x / cellX - x0)
  }
  const out = new Float32Array(n * n)
  for (let y = 0; y < n; y++) {
    const y0 = Math.floor(y / cellY)
    const ty = ease(y / cellY - y0)
    const r0 = (y0 % my) * mx
    const r1 = ((y0 + 1) % my) * mx
    for (let x = 0; x < n; x++) {
      const a = lattice[r0 + c0[x]]
      const c = lattice[r1 + c0[x]]
      const s = a + (lattice[r0 + c1[x]] - a) * tx[x]
      const nn = c + (lattice[r1 + c1[x]] - c) * tx[x]
      out[y * n + x] = s + (nn - s) * ty
    }
  }
  return out
}

export interface DetailTile {
  size: number
  /** RGBA bytes, row-major. */
  data: Uint8Array
  /** Mean of `gullyChannel` over the tile: the shader fades gullies to it with distance. */
  gullyMean: number
}

/** Recentre a field on 0.5 with the given spread, clamped to 0–1, as bytes. */
function toBytes(f: Float32Array, spread: number, out: Uint8Array, channel: number) {
  let mean = 0
  for (const v of f) mean += v
  mean /= f.length
  for (let i = 0; i < f.length; i++) {
    const v = Math.min(1, Math.max(0, 0.5 + (f[i] - mean) * spread))
    out[i * 4 + channel] = Math.round(v * 255)
  }
}

/** Builds the detail tile (1 MB). Use `detailTile`, which builds it once per page. */
function buildDetailTile(): DetailTile {
  const n = DETAIL_SIZE
  const data = new Uint8Array(n * n * 4)
  const seed = 0x51ce
  const white = (i: number, s: number) => hash2(i % n, (i / n) | 0, s)

  // R, jointing: faceted blocks about 4 m and 2 m across, split by a network of darker fractures.
  const big = tileNoise(n, 8, 8, seed, false)
  const small = tileNoise(n, 4, 4, seed + 1, false)
  // Faceted (plain bilinear) fields, so their mid-value lines run straight and kink like joint sets
  // instead of curling like smooth noise.
  const crack = tileNoise(n, 16, 16, seed + 2, false)
  const crack2 = tileNoise(n, 8, 8, seed + 3, false)
  const joint = new Float32Array(n * n)
  for (let i = 0; i < joint.length; i++) {
    const lines = Math.max(
      1 - smoothstep(0, 0.05, Math.abs(crack[i] - 0.5)),
      0.7 * (1 - smoothstep(0, 0.04, Math.abs(crack2[i] - 0.5))),
    )
    joint[i] = 0.55 * big[i] + 0.35 * small[i] + 0.1 * white(i, seed + 4) - 0.5 * lines
  }
  toBytes(joint, 1.15, data, 0)

  // G, gullies: noise four times longer down the tile (v) than across it, so its mid-value lines
  // run down the wall, spaced several metres apart.
  const g1 = tileNoise(n, 16, 64, seed + 5)
  const g2 = tileNoise(n, 8, 32, seed + 6)
  const gully = Float32Array.from(g1, (v, i) => 0.65 * v + 0.35 * g2[i])
  toBytes(gully, 1.6, data, 1)

  // B, grain: gravel and pitting, texel-sized and a little larger.
  const fine = tileNoise(n, 2, 2, seed + 7)
  const grain = Float32Array.from(fine, (v, i) => 0.55 * white(i, seed + 8) + 0.45 * v)
  toBytes(grain, 1.3, data, 2)

  // A, where rain has cut gullies: patches tens of metres across.
  toBytes(tileNoise(n, 64, 64, seed + 9), 2, data, 3)

  let gullyMean = 0
  for (let i = 0; i < n * n; i++) gullyMean += gullyChannel(data[i * 4 + 1] / 255)
  return { size: n, data, gullyMean: gullyMean / (n * n) }
}

let cached: DetailTile | null = null

/** The detail tile, shared by every terrain on the page. */
export const detailTile = (): DetailTile => (cached ??= buildDetailTile())

/**
 * GPU texture for the tile: repeats, mipmapped (so detail fades out with distance), linear data.
 * One mip level per sample, not a blend of two: half the texel reads, and a step between levels
 * of noise does not show.
 */
export function detailTexture(): THREE.DataTexture {
  const tile = detailTile()
  const t = new THREE.DataTexture(tile.data, tile.size, tile.size, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = THREE.LinearMipmapNearestFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

const TILE = DETAIL_TILE_M.toFixed(1)

/** Fragment-shader declarations for the detail: uniforms, varyings and the wall directions. */
export const ROCK_DETAIL_PARS = `
uniform sampler2D uDetail;
uniform float uGullyMean;
uniform vec3 uStain;
// Plan metres east and north, and height above the scene base, unexaggerated.
varying vec3 vRockP;
varying vec3 vSlopeN;
// Unit vector along one of six fixed wall directions, 30° apart; k wraps, so direction 6 is 0.
vec2 rockAxis(float k) {
  float a = mod(k, 6.0) * (PI / 6.0);
  return vec2(cos(a), sin(a));
}
`

/**
 * Fragment code, after the aerial image or tint and before contours and overlays: rock jointing
 * and gullies on steep faces, grain on flat ground. Colour changes keep their mean, so the
 * overall tone does not shift as the camera zooms. Leaves `rockHeight` (metres, zero mean) for
 * the normal perturbation.
 *
 * Two texture reads in all, and no branches: a software renderer runs both sides of a branch, so
 * the number of reads in the code is what a frame pays for. Both are plain reads with screen
 * derivatives; explicit gradients (textureGrad) cost the software renderer about a fifth of the
 * whole frame at the Pit preset, plain reads about a twentieth.
 */
export const ROCK_DETAIL_COLOR = `
  vec3 rockN = normalize(vSlopeN);
  // Steep faces only (roughly 25° and up, on the true slope, whatever the exaggeration).
  float rockWall = 1.0 - smoothstep(0.76, 0.9, rockN.y);
  vec3 rockDpx = dFdx(vRockP);
  vec3 rockDpy = dFdy(vRockP);
  // Texels per pixel. Gullies narrower than a few texels cannot be drawn, so they fade to their
  // average; beyond 6 (3 m a pixel) the tile's mip levels are flat noise, so the detail fades out.
  float rockFoot = max(length(rockDpx), length(rockDpy)) * ${(DETAIL_SIZE / DETAIL_TILE_M).toFixed(4)};
  float rockNear = 1.0 - smoothstep(3.0, 6.0, rockFoot);
  // A face is read on vertical planes along it (u along the wall, v up it), so jointing stays
  // blocky and gullies, which run down the tile's v axis, run down the fall line. The wall runs
  // across its downslope direction, between two of six fixed directions 30° apart: one read
  // takes the nearest even direction, the other the nearest odd one, blended by distance. Each
  // read changes direction only where its weight is zero, so neither leaves a seam and the
  // ordinary screen derivatives pick its mip level.
  vec2 rockAlong = vec2(-rockN.z, -rockN.x);
  rockAlong = length(rockAlong) > 1e-4 ? rockAlong : vec2(1.0, 0.0);
  float rockA = mod(atan(rockAlong.y, rockAlong.x), PI) / (PI / 6.0);
  float rockEven = 2.0 * floor(rockA * 0.5 + 0.5);
  float rockOdd = 2.0 * floor(rockA * 0.5) + 1.0;
  float rockT = abs(rockA - rockEven);
  vec2 rockE0 = rockAxis(rockEven);
  vec2 rockE1 = rockAxis(rockOdd);
  // The first read is the ground from above on flat ground and the even direction on a face. Both
  // kinds of detail fade to nothing where the slope crosses between them (along the crests and
  // toes), so that switch leaves no seam either.
  vec2 rockU0 = rockWall > 0.5 ? vec2(dot(vRockP.xy, rockE0), vRockP.z) : vRockP.xy;
  vec4 rockS0 = texture(uDetail, rockU0 / ${TILE});
  vec4 rockS1 = texture(uDetail, vec2(dot(vRockP.xy, rockE1), vRockP.z) / ${TILE});
  // Blending two directions lowers the contrast; restore it so the detail does not fade between them.
  vec3 rockW = 0.5 + (mix(rockS0.rga, rockS1.rga, rockT) - 0.5)
    * inversesqrt(rockT * rockT + (1.0 - rockT) * (1.0 - rockT));
  float rockFaceW = smoothstep(0.5, 0.65, rockWall) * rockNear;
  float rockFlatW = (1.0 - smoothstep(0.35, 0.5, rockWall)) * rockNear;
  float rockGullyC = (1.0 - smoothstep(0.0, ${GULLY_WIDTH.toFixed(4)}, abs(rockW.g - 0.5)) - uGullyMean)
    * (1.0 - smoothstep(1.5, 4.0, rockFoot)) * rockFaceW * smoothstep(0.3, 0.75, rockW.b);
  float rockJointC = (rockW.r - 0.5) * rockFaceW;
  float rockGrainC = (rockS0.b - 0.5) * rockFlatW;
  // Over the tint the detail stays, at the same reduced strength as the photo's own detail.
  float rockStrength = mix(1.0, 0.35, uTint);
  diffuseColor.rgb *= 1.0 + rockStrength * (0.5 * rockJointC + 0.16 * rockGrainC);
  // Gullies are stained darker; the ribs between them read as washed rock.
  diffuseColor.rgb *= mix(vec3(1.0), uStain, clamp(rockGullyC * 0.9 * rockStrength, -0.6, 1.0));
  // Relief on the walls only: flat ground keeps its grain as colour.
  float rockHeight = 0.5 * rockJointC - 0.6 * rockGullyC;
`

/**
 * The flat-ground grain alone, for ground with no rock faces (the apron around the block). `p` is a
 * varying of plan metres east and north, as `vRockP.xy`. It is the tile, registration, strength
 * and fade ROCK_DETAIL_COLOR gives flat ground, so the grain runs on across the block's edge: keep
 * the two in step. Needs `uniform sampler2D uDetail`.
 */
export const groundGrain = (p: string) => `
  {
    float grainFoot = max(length(dFdx(${p})), length(dFdy(${p}))) * ${(DETAIL_SIZE / DETAIL_TILE_M).toFixed(4)};
    float grain = (texture(uDetail, ${p} / ${TILE}).b - 0.5) * (1.0 - smoothstep(3.0, 6.0, grainFoot));
    diffuseColor.rgb *= 1.0 + 0.16 * grain;
  }
`

/**
 * Bump from `rockHeight`, after the normal is set up (Mikkelsen's surface-gradient method on the
 * view-space position, so it works at any exaggeration and needs no tangents).
 */
export const ROCK_DETAIL_NORMAL = `
  {
    vec3 sx = dFdx(-vViewPosition);
    vec3 sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal);
    vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(rockHeight) * r1 + dFdy(rockHeight) * r2);
    normal = normalize(abs(det) * normal - grad);
  }
`

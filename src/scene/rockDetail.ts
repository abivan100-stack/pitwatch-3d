import * as THREE from 'three'
import { hash2 } from '../data/rng'

/*
 * Close-range detail for the terrain surface. The aerial image is about 1 m per pixel, so near the
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
  const crack = tileNoise(n, 16, 16, seed + 2)
  const crack2 = tileNoise(n, 8, 8, seed + 3)
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

/** GPU texture for the tile: repeats, mipmapped (so detail fades out with distance), linear data. */
export function detailTexture(): THREE.DataTexture {
  const tile = detailTile()
  const t = new THREE.DataTexture(tile.data, tile.size, tile.size, THREE.RGBAFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

const TILE = DETAIL_TILE_M.toFixed(1)

/** Fragment-shader declarations for the detail: uniforms, varyings and the wall sampler. */
export const ROCK_DETAIL_PARS = `
uniform sampler2D uDetail;
uniform float uGullyMean;
uniform vec3 uStain;
// Plan metres east and north, and height above the scene base, unexaggerated.
varying vec3 vRockP;
varying vec3 vSlopeN;
// The tile on a vertical plane along one of six fixed wall directions (30° apart); k wraps, so
// direction 6 is direction 0. u runs along the wall, v up it.
vec4 rockWallSample(vec3 p, vec3 dpx, vec3 dpy, float k) {
  float a = mod(k, 6.0) * (PI / 6.0);
  vec2 e = vec2(cos(a), sin(a));
  // Explicit gradients: the direction switches between neighbouring pixels, and implicit
  // derivatives across that switch would pick a blurred mip level and draw a seam.
  return textureGrad(uDetail, vec2(dot(p.xy, e), p.z) / ${TILE},
    vec2(dot(dpx.xy, e), dpx.z) / ${TILE}, vec2(dot(dpy.xy, e), dpy.z) / ${TILE});
}
`

/**
 * Fragment code, after the aerial image or tint and before contours and overlays: rock jointing
 * and gullies on steep faces, grain on flat ground. Colour changes keep their mean, so the
 * overall tone does not shift as the camera zooms. Leaves `rockHeight` (metres, zero mean) for
 * the normal perturbation.
 */
export const ROCK_DETAIL_COLOR = `
  vec3 rockN = normalize(vSlopeN);
  // Steep faces only (roughly 25° and up, on the true slope, whatever the exaggeration).
  float rockWall = 1.0 - smoothstep(0.76, 0.9, rockN.y);
  vec3 rockDpx = dFdx(vRockP);
  vec3 rockDpy = dFdy(vRockP);
  vec4 rock = texture2D(uDetail, vRockP.xy / ${TILE});
  // The wall runs across its downslope direction; blend the two nearest fixed directions.
  vec2 rockAlong = vec2(-rockN.z, -rockN.x);
  float rockAlongLen = length(rockAlong);
  rockAlong = rockAlongLen > 1e-4 ? rockAlong / rockAlongLen : vec2(1.0, 0.0);
  float rockA = mod(atan(rockAlong.y, rockAlong.x), PI) / (PI / 6.0);
  float rockK = floor(rockA);
  float rockT = rockA - rockK;
  vec2 rockRG = mix(rockWallSample(vRockP, rockDpx, rockDpy, rockK).rg,
    rockWallSample(vRockP, rockDpx, rockDpy, rockK + 1.0).rg, rockT);
  // Blending two samples lowers their contrast; restore it so the detail does not fade between directions.
  rockRG = 0.5 + (rockRG - 0.5) * inversesqrt(rockT * rockT + (1.0 - rockT) * (1.0 - rockT));
  // Texels per pixel on the wall: once a gully is narrower than that it cannot be drawn, so it
  // fades to its average.
  float rockFoot = max(length(rockDpx), length(rockDpy)) * ${(DETAIL_SIZE / DETAIL_TILE_M).toFixed(4)};
  float rockGullyC = (1.0 - smoothstep(0.0, ${GULLY_WIDTH.toFixed(4)}, abs(rockRG.g - 0.5)) - uGullyMean)
    * (1.0 - smoothstep(1.5, 4.0, rockFoot)) * rockWall * smoothstep(0.3, 0.75, rock.a);
  float rockJoint = mix(rock.r, rockRG.r, rockWall);
  // Over the tint the detail stays, at the same reduced strength as the photo's own detail.
  float rockStrength = mix(1.0, 0.35, uTint);
  diffuseColor.rgb *= 1.0 + rockStrength * ((rockJoint - 0.5) * 0.5 * rockWall + (rock.b - 0.5) * 0.16 * (1.0 - rockWall));
  // Gullies are stained darker; the ribs between them read as washed rock.
  diffuseColor.rgb *= mix(vec3(1.0), uStain, clamp(rockGullyC * 0.9 * rockStrength, -0.6, 1.0));
  float rockHeight = (rockJoint - 0.5) * 0.5 * rockWall - 0.6 * rockGullyC + (rock.b - 0.5) * 0.08 * (1.0 - rockWall);
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

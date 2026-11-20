import type { GridSpec, Orthophoto } from '../domain/types'
import { cellCenter } from '../geo/grid'
import { CREEK } from './fixtures/scenario'
import { bakedShade, naturalNoise, paintNaturalGround } from './orthophoto'
import { creekDistance, distanceToLine, naturalGround } from './synthetic'

/*
 * The apron: natural ground around the surveyed block, so the 3D model sits in a landscape
 * instead of floating on the paper. It is the same `naturalGround` the block is cut from, on a
 * coarse lattice that is aligned to the block's grid, and nothing else: no pit, dump, pond or
 * haul road, which exist only inside the surveyed area. It is decoration, not a survey. Nothing
 * here is read by the engine, the Inspector, the measurements or the exports.
 *
 * It is painted by the same natural-ground rules, noises and seed as the block's aerial image, only
 * coarser, so scrub, soil patches and trees run across the edge of the survey and the block does not
 * read as a tile laid on a plain field.
 */

/** Lattice spacing, metres: eight block cells, so the apron costs far fewer triangles per metre. */
export const APRON_CELL_M = 32
/** How far the apron reaches beyond each edge of the block, metres (a whole number of cells). */
export const APRON_REACH_M = 3008

/**
 * Distance beyond the block's edge, metres, over which the apron fades from solid to transparent.
 * It ends inside the reach, so the apron's own outer edge is never seen.
 */
export const APRON_FADE_M = { from: 900, to: 3000 } as const

export interface ApronGrid {
  /** Vertex lattice covering block and apron, aligned to the block. */
  grid: GridSpec
  /** Lattice cells that lie inside the surveyed block: [c0, c1) x [r0, r1). The apron has none. */
  hole: { c0: number; c1: number; r0: number; r1: number }
}

/** The lattice for a survey grid. Its vertices on the block's edge are vertices of the block too. */
export function apronGrid(g: GridSpec): ApronGrid {
  const w = (g.cols - 1) * g.cellSize
  const h = (g.rows - 1) * g.cellSize
  if (w % APRON_CELL_M || h % APRON_CELL_M) {
    throw new Error('The apron lattice must line up with the survey grid')
  }
  const reach = APRON_REACH_M / APRON_CELL_M
  return {
    grid: {
      cols: w / APRON_CELL_M + 2 * reach + 1,
      rows: h / APRON_CELL_M + 2 * reach + 1,
      cellSize: APRON_CELL_M,
      originXY: { x: g.originXY.x - APRON_REACH_M, y: g.originXY.y - APRON_REACH_M },
    },
    hole: { c0: reach, c1: reach + w / APRON_CELL_M, r0: reach, r1: reach + h / APRON_CELL_M },
  }
}

/** Ground level (RL, m) at every lattice vertex. */
export function apronHeights(a: ApronGrid, seed: number): Float32Array {
  const { grid } = a
  const out = new Float32Array(grid.cols * grid.rows)
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      out[row * grid.cols + col] = naturalGround(cellCenter(grid, col, row), seed)
    }
  }
  return out
}

/**
 * The image painted around the block reaches this far beyond each edge, metres. Further out, where
 * the apron is already more than half faded, the material mirrors the image instead of painting
 * ground nobody can make out.
 */
export const APRON_PHOTO_REACH_M = 2048
/**
 * Side of that image, pixels: 4.8 m per pixel over the block and its reach (6.6 MB). At 1,536 px
 * it took as long to paint as the baseline survey has to spare before the current one is ready.
 */
export const APRON_PHOTO_SIZE = 1280

/** Beyond this distance from the creek, metres, its bed and bank trees paint nothing. */
const CREEK_REACH_M = 200
/** The painted creek runs out this far short of the image's border, so its mirror never shows. */
const CREEK_END_M = 400

/**
 * The creek's course carried straight on past both of its ends, so in the picture it runs out of
 * sight instead of stopping just outside the survey. The ground's own shape is not changed.
 */
const CREEK_COURSE = (() => {
  const on = ([ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]) => {
    const k = (2 * APRON_REACH_M) / Math.hypot(ax - bx, ay - by)
    return [ax + (ax - bx) * k, ay + (ay - by) * k] as const
  }
  const n = CREEK.length
  return [on(CREEK[0], CREEK[1]), ...CREEK, on(CREEK[n - 1], CREEK[n - 2])]
})()

/** Bilinear blend of a lattice `w` nodes wide, from node `k` with weights `tx`, `ty`. */
const blend = (f: Float32Array, k: number, w: number, tx: number, ty: number) =>
  (f[k] * (1 - tx) + f[k + 1] * tx) * (1 - ty) + (f[k + w] * (1 - tx) + f[k + w + 1] * tx) * ty

/**
 * Simulated aerial image of the ground around the block: the block and APRON_PHOTO_REACH_M beyond
 * each edge (row 0 is the southern edge, and uv 0–1 spans that extent exactly). It is
 * `paintNaturalGround`, the block image's own painter, fed the same noises at the same places, so
 * the two images agree wherever the block is still natural ground. Slope and hollows come from the
 * lattice's own `heights`. Vegetation density and the distance to the creek change slowly, so they
 * are worked out every second pixel and blended, as the block's image blends them between cells.
 */
export function buildApronPhoto(
  a: ApronGrid,
  heights: Float32Array,
  seed: number,
  size = APRON_PHOTO_SIZE,
): Orthophoto {
  const g = a.grid
  const x0 = g.originXY.x + a.hole.c0 * g.cellSize - APRON_PHOTO_REACH_M
  const y0 = g.originXY.y + a.hole.r0 * g.cellSize - APRON_PHOTO_REACH_M
  const spanX = (a.hole.c1 - a.hole.c0) * g.cellSize + 2 * APRON_PHOTO_REACH_M
  const spanY = (a.hole.r1 - a.hole.r0) * g.cellSize + 2 * APRON_PHOTO_REACH_M

  const slope = new Float32Array(heights.length)
  const hollow = new Float32Array(heights.length)
  const at = (c: number, r: number) =>
    heights[Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c))]
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const gx = (at(c + 1, r) - at(c - 1, r)) / (2 * g.cellSize)
      const gy = (at(c, r + 1) - at(c, r - 1)) / (2 * g.cellSize)
      slope[r * g.cols + c] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI
      // Positive in hollows and at the foot of slopes, negative on crests.
      hollow[r * g.cols + c] =
        (at(c + 1, r) + at(c - 1, r) + at(c, r + 1) + at(c, r - 1) - 4 * at(c, r)) /
        (g.cellSize * g.cellSize)
    }
  }

  // A lattice with a node every second pixel.
  const w = size / 2 + 1
  const veg = new Float32Array(w * w)
  const creek = new Float32Array(w * w)
  for (let r = 0; r < w; r++) {
    for (let c = 0; c < w; c++) {
      const p = { x: x0 + (c / (w - 1)) * spanX, y: y0 + (r / (w - 1)) * spanY }
      veg[r * w + c] = naturalNoise.veg(p.x, p.y, seed)
      // The creek's meanders stay within 55 m of its course, so far from it the distance is moot.
      // Metres past the point where the creek runs out, measured out from the block.
      const past = Math.max(x0 - p.x, p.x - x0 - spanX, y0 - p.y, p.y - y0 - spanY) + CREEK_END_M
      creek[r * w + c] =
        distanceToLine(p, CREEK_COURSE) < CREEK_REACH_M
          ? creekDistance(p, seed, CREEK_COURSE) + Math.max(0, past)
          : CREEK_REACH_M
    }
  }

  const rgba = new Uint8Array(size * size * 4)
  const rgb = [0, 0, 0]
  const crownAt = (x: number, y: number) => naturalNoise.crown(x, y, seed)
  for (let j = 0; j < size; j++) {
    const py = y0 + ((j + 0.5) / size) * spanY
    // Node and weight in the fine lattice, then in the height lattice.
    const fr = Math.min(w - 2, Math.floor((j + 0.5) / 2))
    const fty = (j + 0.5) / 2 - fr
    const gy = (py - g.originXY.y) / g.cellSize
    const gr = Math.min(g.rows - 2, Math.floor(gy))
    for (let i = 0; i < size; i++) {
      const px = x0 + ((i + 0.5) / size) * spanX
      const fc = Math.min(w - 2, Math.floor((i + 0.5) / 2))
      const ftx = (i + 0.5) / 2 - fc
      const fk = fr * w + fc
      const gx = (px - g.originXY.x) / g.cellSize
      const gc = Math.min(g.cols - 2, Math.floor(gx))
      const gk = gr * g.cols + gc
      const blotch = naturalNoise.blotch(px, py, seed)
      const grain = naturalNoise.grain(px, py, seed)
      paintNaturalGround(
        rgb,
        px,
        py,
        blend(veg, fk, w, ftx, fty),
        blotch,
        grain,
        blend(creek, fk, w, ftx, fty),
        blend(slope, gk, g.cols, gx - gc, gy - gr),
        crownAt,
      )
      const shade = bakedShade(blend(hollow, gk, g.cols, gx - gc, gy - gr), grain)
      const o = (j * size + i) * 4
      rgba[o] = Math.min(255, rgb[0] * shade)
      rgba[o + 1] = Math.min(255, rgb[1] * shade)
      rgba[o + 2] = Math.min(255, rgb[2] * shade)
      rgba[o + 3] = 255
    }
  }
  return { width: size, height: size, rgba, provenance: 'simulated' }
}

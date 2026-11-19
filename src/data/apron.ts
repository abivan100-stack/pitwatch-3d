import type { GridSpec } from '../domain/types'
import { cellCenter } from '../geo/grid'
import { naturalGround } from './synthetic'

/*
 * The apron: natural ground around the surveyed block, so the 3D model sits in a landscape
 * instead of floating on the paper. It is the same `naturalGround` the block is cut from, on a
 * coarse lattice that is aligned to the block's grid, and nothing else: no pit, dump, pond or
 * haul road, which exist only inside the surveyed area. It is decoration, not a survey. Nothing
 * here is read by the engine, the Inspector, the measurements or the exports.
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

import type {
  DumpZone,
  GridSpec,
  Mine,
  PermittedLimits,
  PitZone,
  Polygon,
} from '../../domain/types'
import { mulberry32 } from '../rng'
import { MINE_INFO } from './mine'

/*
 * Geometry of the fictional Venthar Ridge scenario. All local metres (X east, Y north).
 * The grid covers 0..2560 m in both directions. Every value here is synthetic.
 */

export const SEED = 20251114

export const GRID: GridSpec = { cols: 641, rows: 641, cellSize: 4, originXY: { x: 0, y: 0 } }

/** Lease boundary. The east edge at x ≈ 1725 m runs close to the pit on purpose. */
export const LEASE: Polygon = [
  { x: 300, y: 275 },
  { x: 2050, y: 300 },
  { x: 2075, y: 1000 },
  { x: 1725, y: 1100 },
  { x: 1731, y: 1650 },
  { x: 1950, y: 1950 },
  { x: 1475, y: 1875 },
  { x: 375, y: 1950 },
]

export const SAFETY_BUFFER_M = 20

/**
 * Natural ground level the pit is cut from (plateau, RL m). Deliberately not a multiple
 * of the 5 m contour interval, so flat berms and the floor sit between contour levels.
 */
export const PLATEAU_RL = 422
export const BENCH_HEIGHT_M = 15
export const BERM_WIDTH_M = 8
/** Horizontal run of one bench face (≈ 59° face angle; overall wall ≈ 41°). */
export const FACE_RUN_M = 9

/**
 * One pit stage: a rim outline (anticlockwise, rounded off before use) and a flat floor.
 * Benches step down from the rim parallel to the outline until they reach the floor.
 */
export interface PitStage {
  outline: Polygon
  floorRL: number
}

const pts = (xy: readonly [number, number][]): Polygon => xy.map(([x, y]) => ({ x, y }))

/**
 * Random pit outline from a seed: a closed blob with a few low-frequency bulges (the way
 * a pit follows an irregular orebody), stretched to fill `box`. Same seed, same outline.
 */
export function randomOutline(
  seed: number,
  box: { x0: number; x1: number; y0: number; y1: number },
  points = 24,
): Polygon {
  const rand = mulberry32(seed)
  const terms = [2, 3, 4, 5, 7].map((k) => ({
    k,
    amp: (0.1 + 0.14 * rand()) / k ** 0.7,
    phase: rand() * 2 * Math.PI,
  }))
  const raw = Array.from({ length: points }, (_, i) => {
    const theta = (i / points) * 2 * Math.PI
    const r = 1 + terms.reduce((sum, t) => sum + t.amp * Math.sin(t.k * theta + t.phase), 0)
    return { x: r * Math.cos(theta), y: r * Math.sin(theta) }
  })
  const xs = raw.map((p) => p.x)
  const ys = raw.map((p) => p.y)
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ]
  return raw.map((p) => ({
    x: box.x0 + ((p.x - minX) / (maxX - minX)) * (box.x1 - box.x0),
    y: box.y0 + ((p.y - minY) / (maxY - minY)) * (box.y1 - box.y0),
  }))
}

/** Seed for the pit outline, separate from the terrain noise. */
export const PIT_SEED = SEED + 101

/**
 * Main pit now: random outline (anticlockwise) inside the lease, about 1,140 m long and 225 m
 * deep (15 benches), floor 2 m above the approved floor. The east wall stops at x = 1662,
 * clear of the lease buffer.
 */
export const CURRENT_PIT: PitStage = {
  floorRL: 197,
  outline: randomOutline(PIT_SEED, { x0: 525, x1: 1662, y0: 888, y1: 1662 }),
}

/**
 * Main pit at the baseline survey: the same pit before its west wall was pushed back
 * (about 95 m at the far west) and before the last bench was mined.
 */
export const BASELINE_PIT: PitStage = {
  floorRL: 212,
  outline: CURRENT_PIT.outline.map((p) => ({
    x: p.x < 875 ? p.x + (875 - p.x) * 0.23 : p.x,
    y: 1275 + (p.y - 1275) * 0.94,
  })),
}

/** Scale an outline about its centroid: permit zones follow the workings they cover. */
export const scaleAbout = (poly: Polygon, factor: number): Polygon => {
  const c = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), {
    x: 0,
    y: 0,
  })
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * factor, y: c.y + (p.y - c.y) * factor }))
}

/** Rounded lobed footprint around a point, for a dump zone that follows the dump it covers. */
export const blobAround = (cx: number, cy: number, r: number, phase: number, n = 24): Polygon =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI
    const rr = r * (1 + 0.07 * Math.sin(2 * t + phase) + 0.05 * Math.sin(3 * t - phase))
    return { x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) }
  })

/** Second working: a satellite pit south of the main one, 106 m deep. */
export const SATELLITE_SEED = SEED + 211
export const CURRENT_PIT_B: PitStage = {
  floorRL: 316,
  outline: randomOutline(SATELLITE_SEED, { x0: 950, x1: 1325, y0: 412, y1: 700 }, 18),
}
/** The satellite pit at the baseline survey: smaller, and a bench shallower. */
export const BASELINE_PIT_B: PitStage = {
  floorRL: 330,
  outline: scaleAbout(CURRENT_PIT_B.outline, 0.8),
}

export const PIT_ZONE: PitZone = {
  id: 'pit-main',
  polygon: scaleAbout(CURRENT_PIT.outline, 1.14),
  approvedFloorElevation: 195,
}

export const PIT_ZONE_B: PitZone = {
  id: 'pit-south',
  polygon: scaleAbout(CURRENT_PIT_B.outline, 1.22),
  approvedFloorElevation: 314,
}

export const DUMP_ZONE: DumpZone = {
  id: 'dump-west',
  polygon: blobAround(675, 638, 206, 0.7),
}

export const DUMP_ZONE_B: DumpZone = {
  id: 'dump-east',
  polygon: blobAround(1600, 588, 175, 2.1),
}

/*
 * Changes planted in the current survey. Each one exists to exercise a rule.
 *   encroachment  R1 violation: a cut lobe that crosses the east lease edge.
 *   sump          R2 violation: a pit below the approved floor.
 *   bufferScrape  R1 warning: a shallow cut inside the safety buffer, not outside the lease.
 *   strayDump     R3 warning: waste placed outside the dump zone.
 *   zoneDump      no finding: waste placed inside the dump zone.
 */
export const CHANGES = {
  /** Pushback of the east wall, benched down into the pit, that runs past the lease edge (x ≈ 1727 here). */
  encroachment: {
    floorRL: 310,
    outline: pts([
      [1550, 1125],
      [1662, 1131],
      [1762, 1188],
      [1810, 1288],
      [1769, 1388],
      [1662, 1438],
      [1550, 1425],
      [1500, 1275],
    ]),
  } satisfies PitStage,
  sump: { cx: 1100, cy: 1275, r: 27, depthBelowFloor: 6 },
  bufferScrape: { x0: 1140, x1: 1260, y0: 1878, y1: 1886, depth: 1.2 },
  /** A cluster of truck-tipped heaps around (cx, cy). */
  strayDump: { cx: 1900, cy: 600, r: 45, height: 4 },
  /** The terraced west dump grows taller and wider (see BASELINE_DUMP). */
  zoneDump: { cx: 675, cy: 638, r: 144, height: 10 },
  /** The east waste dump also grows inside its own zone: no finding. */
  zoneDumpB: { cx: 1600, cy: 588, r: 125, height: 12 },
} as const

/** Terraced waste dump that already exists in the baseline survey, inside the dump zone. */
export const BASELINE_DUMP = { cx: 662, cy: 631, r: 106, height: 5 } as const
export const BASELINE_DUMP_B = { cx: 1594, cy: 581, r: 88, height: 6 } as const

/** Settling pond at a low point south-west of the main pit, present in both surveys. */
export const POND = { cx: 700, cy: 1750, r: 75, depth: 7 } as const

/**
 * Haul ramp in the main pit: leaves the rim at the point nearest `start` (where the
 * haul road arrives) and runs anticlockwise down the wall at `grade` until the floor.
 */
export const RAMP = {
  start: { x: 1125, y: 894 },
  startB: { x: 1131, y: 700 },
  grade: 0.1,
  width: 30,
} as const

/** Crest line of Venthar Ridge, north of the lease (local metres). */
export const RIDGE: readonly [number, number][] = [
  [-188, 2050],
  [500, 2238],
  [1125, 2325],
  [1750, 2250],
  [2750, 2388],
]

/** Broad rises on the plateau, so the block has shape away from the ridge too. */
export const RISES: readonly { cx: number; cy: number; r: number; h: number }[] = [
  { cx: 2250, cy: 1850, r: 375, h: 34 },
  { cx: 112, cy: 950, r: 325, h: 26 },
]

/** Dry creek bed east of the lease, draining south, with a wide floodplain. */
export const CREEK: readonly [number, number][] = [
  [2750, 1500],
  [2312, 1162],
  [2169, 800],
  [2212, 400],
  [2112, -188],
]

/**
 * Haul roads on the plateau (local metres). They only appear in the simulated aerial
 * image; on the ground they are flat enough not to matter at survey resolution. A network:
 * the main ramp and the satellite pit meet at a junction, which feeds the west dump, the
 * east dump and the lease gate to the north.
 */
export const ROADS: readonly (readonly [number, number][])[] = [
  // Main pit ramp to the first junction.
  [
    [1125, 894],
    [1162, 812],
    [1200, 750],
  ],
  // Satellite pit down to the same junction.
  [
    [1131, 700],
    [1162, 725],
    [1200, 750],
  ],
  // Junction to the west dump.
  [
    [1200, 750],
    [1000, 712],
    [825, 650],
    [700, 631],
  ],
  // Junction to the second junction, then the east dump and the stray-dump track.
  [
    [1200, 750],
    [1325, 700],
    [1412, 625],
  ],
  [
    [1412, 625],
    [1537, 587],
    [1625, 587],
  ],
  [
    [1625, 587],
    [1775, 587],
    [1875, 593],
  ],
  // Out of the lease gate to the north.
  [
    [1412, 625],
    [1437, 375],
    [1475, 0],
  ],
]

export const SURVEY_SIGMA_M = { baseline: 0.05, current: 0.05 } as const
/**
 * Horizontal position uncertainty of each survey, metres (1σ, each plan axis). Simulated like the
 * vertical one: ground-controlled drone photogrammetry is usually a little worse in plan than in
 * height, and this is what makes a point next to the lease line honestly ambiguous.
 */
export const SURVEY_HORIZONTAL_SIGMA_M = 0.1

export const LIMITS: PermittedLimits = {
  leaseBoundary: LEASE,
  safetyBufferMetres: SAFETY_BUFFER_M,
  pitZones: [PIT_ZONE, PIT_ZONE_B],
  maxPitDepth: PLATEAU_RL - PIT_ZONE.approvedFloorElevation,
  dumpZones: [DUMP_ZONE, DUMP_ZONE_B],
}

export const MINE: Mine = {
  ...MINE_INFO,
  leaseBoundary: LEASE,
  approvedZones: [
    { id: PIT_ZONE.id, name: 'Main pit', kind: 'pit', polygon: PIT_ZONE.polygon },
    { id: PIT_ZONE_B.id, name: 'South pit', kind: 'pit', polygon: PIT_ZONE_B.polygon },
    { id: DUMP_ZONE.id, name: 'West waste dump', kind: 'dump', polygon: DUMP_ZONE.polygon },
    { id: DUMP_ZONE_B.id, name: 'East waste dump', kind: 'dump', polygon: DUMP_ZONE_B.polygon },
  ],
  metadata: {
    benchHeight: `${BENCH_HEIGHT_M} m`,
    bermWidth: `${BERM_WIDTH_M} m`,
    grid: `${GRID.cols} × ${GRID.rows} cells at ${GRID.cellSize} m`,
  },
}

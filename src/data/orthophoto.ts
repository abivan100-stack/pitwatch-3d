import type { GridSpec, Orthophoto } from '../domain/types'
import { cellCenter } from '../geo/grid'
import { distanceToSegment } from '../geo/polygon'
import {
  BASELINE_PIT,
  BENCH_HEIGHT_M,
  BERM_WIDTH_M,
  CHANGES,
  CURRENT_PIT,
  FACE_RUN_M,
  PLATEAU_RL,
  POND,
  RAMP,
  ROADS,
  SEED,
} from './fixtures/scenario'
import { fbm, valueNoise } from './noise'
import { hash2 } from './rng'
import { benchDepth, creekDistance, insidePit, pitsOf, rampDistance } from './synthetic'

/*
 * Simulated aerial image for the fictional mine, so the 3D model reads like a drone
 * survey (elevation model + orthomosaic) instead of a coloured height map.
 * Colours come from what each place would plausibly look like from the air: scrub and
 * dry grass on red lateritic soil, banded iron rock in the pit walls, dusty berms,
 * waste dumps and haul roads. Shading in hollows is baked in, as in a real photo.
 *
 * The pit is painted as worked ground: walls of banded rock that change with slope and aspect,
 * berms that drain to the toe of the face above and carry a wear track, a haul ramp with ruts and
 * a broken edge, and a floor of wet and dry patches with spoil at the toes and a sump of standing
 * water. None of it touches the elevations: the image is painted from the survey, never the
 * other way round.
 */

type RGB = readonly [number, number, number]

/** Surface colours used in the image (sRGB 0–255). */
export const SURFACE = {
  trees: [70, 80, 52],
  scrub: [124, 124, 84],
  grass: [162, 152, 114],
  soil: [150, 108, 80],
  cleared: [170, 144, 116],
  road: [198, 180, 148],
  rockRed: [124, 66, 48],
  rockGrey: [114, 108, 102],
  rockOchre: [166, 118, 68],
  /** Shaded, damp-stained rock and the fractures between blocks. */
  rockDark: [84, 62, 52],
  /** Pale chert and weathered ochre laminae between the iron-rich bands. */
  rockPale: [190, 156, 116],
  berm: [166, 136, 106],
  floor: [122, 100, 82],
  /** Damp ground where water sits: berm drains, wet patches on the floor, mud at the sump. */
  wet: [96, 82, 70],
  /** Ground compacted by tyres: the running surface of the ramp and the tracks on berms and floor. */
  wear: [192, 172, 144],
  /** Wheel ruts in the haul ramp. */
  rut: [138, 116, 94],
  /** Loose broken rock: spill at the toes and along the ramp edge. */
  spoil: [132, 118, 104],
  water: [78, 96, 90],
  waterDeep: [50, 68, 68],
  /** Pale scum line at the water's edge. */
  tide: [176, 166, 144],
  shadow: [56, 54, 40],
  waste: [166, 152, 136],
  freshCut: [172, 110, 74],
  creekSand: [196, 170, 132],
} as const satisfies Record<string, RGB>

/** Map key: what the main colours in the image mean. */
export const SURFACE_KEY: readonly { label: string; rgb: RGB }[] = [
  { label: 'Scrub', rgb: SURFACE.scrub },
  { label: 'Bare soil', rgb: SURFACE.soil },
  { label: 'Exposed rock', rgb: SURFACE.rockRed },
  { label: 'Waste rock', rgb: SURFACE.waste },
  { label: 'Haul road', rgb: SURFACE.road },
]

/**
 * Image size the provider draws: 1280 px over the 2048 m grid, about 1.6 m per pixel. Close range
 * is the shader's detail tile (src/scene/rockDetail.ts): 2048 px cost about a quarter more time to
 * the first engine result, and half as much again to the landing model.
 */
export const ORTHOPHOTO_SIZE = 1280

/** The photo's sun, from the north-west like the tree shadows (plan unit vector, east and north). */
const SUN = { x: -Math.SQRT1_2, y: Math.SQRT1_2 }

/** Bench period across the wall: one face run plus one berm, metres in plan. */
const BENCH_STEP = BERM_WIDTH_M + FACE_RUN_M

/**
 * How far inside the rim the floor of a pit `depth` metres deep begins: the inverse of
 * `benchDepth` at its last face.
 */
export function floorStartFor(depth: number): number {
  const k = Math.ceil(depth / BENCH_HEIGHT_M) - 1
  return k * BENCH_STEP + ((depth - k * BENCH_HEIGHT_M) / BENCH_HEIGHT_M) * FACE_RUN_M
}

/**
 * Bench coordinate of a point `edge` metres inside a rim: the same ragged distance the benches
 * are cut by (see `pitSurface`), so berm and toe marks land on the berms and toes of the surface.
 */
export const benchCoordinate = (x: number, y: number, edge: number) =>
  edge + 2.4 * fbm(x / 28, y / 28, SEED + 91, 2) * Math.min(1, edge / 12)

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * `valueNoise(x / scale, y / scale, seed)` for x and y between `lo` and `hi` metres, read from a
 * lattice hashed once. Same values; the image calls these for every one of its 4.2 M pixels.
 */
function noiseTable(lo: number, hi: number, scale: number, seed: number) {
  const i0 = Math.floor(lo / scale)
  const w = Math.floor(hi / scale) - i0 + 2
  const lattice = new Float64Array(w * w)
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) lattice[j * w + i] = hash2(i + i0, j + i0, seed)
  }
  return (x: number, y: number) => {
    const fx = x / scale
    const fy = y / scale
    const ix = Math.floor(fx)
    const iy = Math.floor(fy)
    let tx = fx - ix
    let ty = fy - iy
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    const k = (iy - i0) * w + (ix - i0)
    const a = lattice[k]
    const b = lattice[k + 1]
    const c = lattice[k + w]
    const d = lattice[k + w + 1]
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
  }
}

function distanceToRoads(x: number, y: number): number {
  let d = Infinity
  for (const road of ROADS) {
    for (let k = 1; k < road.length; k++) {
      const [ax, ay] = road[k - 1]
      const [bx, by] = road[k]
      d = Math.min(d, distanceToSegment({ x, y }, { x: ax, y: ay }, { x: bx, y: by }))
    }
  }
  return d
}

/**
 * @param elevations the survey surface (its slopes and hollows drive the shading)
 * @param natural    original ground level per cell (see `naturalField`)
 * @param size       image width and height in pixels (1280 ≈ 1.6 m per pixel)
 */
export function buildOrthophoto(
  g: GridSpec,
  elevations: Float32Array,
  natural: Float32Array,
  epoch: 'baseline' | 'current',
  seed: number,
  size = ORTHOPHOTO_SIZE,
): Orthophoto {
  const mainPit = epoch === 'baseline' ? BASELINE_PIT : CURRENT_PIT
  const pits = pitsOf(epoch)
  const floorStart = pits.map((k) => floorStartFor(PLATEAU_RL - k.floorRL))
  const n = g.cols * g.rows

  // Per-cell fields, sampled bilinearly per pixel.
  const slope = new Float32Array(n)
  const gradX = new Float32Array(n)
  const gradY = new Float32Array(n)
  const hollow = new Float32Array(n)
  const veg = new Float32Array(n)
  const pitIn = new Float32Array(n)
  const road = new Float32Array(n)
  const blotchF = new Float32Array(n)
  const creek = new Float32Array(n)
  const ramp = new Float32Array(n)
  // Bench coordinate in the pit that shapes this cell, and which pit that is (-1: none).
  const bench = new Float32Array(n)
  const pitOf = new Int8Array(n)
  const at = (c: number, r: number) =>
    elevations[Math.min(g.rows - 1, Math.max(0, r)) * g.cols + Math.min(g.cols - 1, Math.max(0, c))]
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c
      const p = cellCenter(g, c, r)
      const gx = (at(c + 1, r) - at(c - 1, r)) / (2 * g.cellSize)
      const gy = (at(c, r + 1) - at(c, r - 1)) / (2 * g.cellSize)
      gradX[i] = gx
      gradY[i] = gy
      slope[i] = (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI
      // Positive in hollows and at the foot of slopes, negative on crests.
      hollow[i] =
        (at(c + 1, r) + at(c - 1, r) + at(c, r + 1) + at(c, r - 1) - 4 * at(c, r)) /
        (g.cellSize * g.cellSize)
      veg[i] = fbm(p.x / 260, p.y / 260, seed + 31, 3)
      const inside = pits.map((k) => insidePit(p, k))
      pitIn[i] = Math.max(-500, ...inside)
      creek[i] = creekDistance(p, seed)
      ramp[i] = pitIn[i] > 0 ? Math.min(500, ...pits.map((k) => rampDistance(p, k))) : 500
      road[i] = distanceToRoads(p.x, p.y)
      blotchF[i] = valueNoise(p.x / 28, p.y / 28, seed + 43)
      // Where pits overlap, the one cut deepest here shapes the ground.
      let best = -1
      let bestZ = Infinity
      let bestS = 0
      for (let k = 0; k < pits.length; k++) {
        if (!(inside[k] > 0)) continue
        const s = benchCoordinate(p.x, p.y, inside[k])
        const z = Math.max(pits[k].floorRL, PLATEAU_RL - benchDepth(Math.max(0, s)))
        if (z < bestZ) {
          bestZ = z
          best = k
          bestS = s
        }
      }
      pitOf[i] = best
      bench[i] = best >= 0 ? bestS : 0
    }
  }

  const rgba = new Uint8Array(size * size * 4)
  const spanX = (g.cols - 1) * g.cellSize
  const spanY = (g.rows - 1) * g.cellSize
  const sump = CHANGES.sump
  const lo = Math.min(g.originXY.x, g.originXY.y) - 4
  const hi = Math.max(g.originXY.x + spanX, g.originXY.y + spanY) + 4
  const grainAt = noiseTable(lo, hi, 6, seed + 41)
  const crownAt = noiseTable(lo, hi, 3.2, seed + 47)

  // Current colour, mutated in place to avoid allocating per pixel.
  let cr = 0
  let cg = 0
  let cb = 0
  const set = (a: RGB) => {
    cr = a[0]
    cg = a[1]
    cb = a[2]
  }
  const toward = (b: RGB, t: number) => {
    cr += (b[0] - cr) * t
    cg += (b[1] - cg) * t
    cb += (b[2] - cb) * t
  }

  // Bilinear weights between cell centres, shared by every field at a pixel.
  let i00 = 0
  let tx = 0
  let ty = 0
  const bil = (f: Float32Array) => {
    const s = f[i00] * (1 - tx) + f[i00 + 1] * tx
    const nn = f[i00 + g.cols] * (1 - tx) + f[i00 + g.cols + 1] * tx
    return s * (1 - ty) + nn * ty
  }

  for (let j = 0; j < size; j++) {
    const fy = (j / (size - 1)) * (g.rows - 1)
    const py = g.originXY.y + (j / (size - 1)) * spanY
    const r0 = Math.min(Math.max(Math.floor(fy), 0), g.rows - 2)
    const tyRow = clamp01(fy - r0)
    for (let i = 0; i < size; i++) {
      const fx = (i / (size - 1)) * (g.cols - 1)
      const px = g.originXY.x + (i / (size - 1)) * spanX
      const c0 = Math.min(Math.max(Math.floor(fx), 0), g.cols - 2)
      i00 = r0 * g.cols + c0
      tx = clamp01(fx - c0)
      ty = tyRow
      const z = bil(elevations)
      const cut = bil(natural) - z
      const s = bil(slope)
      const grain = grainAt(px, py)
      const blotch = bil(blotchF)
      const inPit = bil(pitIn)
      // Local brightness on top of the baked hollow shading (blocks of rock, lumps of spoil).
      let local = 1

      const toPond = Math.sqrt((px - POND.cx) ** 2 + (py - POND.cy) ** 2)
      if (toPond < POND.r * 0.85) {
        // The settling pond: murky standing water.
        set(SURFACE.water)
        toward(SURFACE.floor, 0.2 * grain)
      } else if (toPond < POND.r) {
        // Wet mud around its edge.
        set(SURFACE.floor)
        toward(SURFACE.soil, 0.3 * grain)
      } else if (cut < -0.4) {
        // Waste rock: pale and granular, darker on the tipped batters.
        set(SURFACE.waste)
        toward(SURFACE.freshCut, 0.15 * blotch)
        if (s > 18) toward(SURFACE.rockGrey, 0.35)
      } else if (cut > 0.4 && inPit > -2) {
        // The pit that shapes this pixel: its floor level and where that floor begins.
        const k = pitOf[Math.round(fy) * g.cols + Math.round(fx)]
        const floorRL = k >= 0 ? pits[k].floorRL : mainPit.floorRL
        const benchS = bil(bench)
        const toSump =
          epoch === 'current'
            ? Math.sqrt((px - sump.cx) ** 2 + (py - sump.cy) ** 2) - sump.r
            : Infinity
        const rd = bil(ramp)
        const half = RAMP.width / 2
        // Where faces, berms and the floor are. On the benched walls, away from the ramp and its
        // batters, the bench coordinate says so to the metre; the slope of the 4 m grid smears
        // each face across most of the 8 m berm below it, so it decides only elsewhere.
        const into = ((benchS % BENCH_STEP) + BENCH_STEP) % BENCH_STEP
        const byBench = k >= 0 && rd > half + 7
        const onFloor = byBench ? benchS >= floorStart[k] : s < 14 && z < floorRL + 0.8
        const onBerm = !onFloor && (byBench ? into >= FACE_RUN_M : s < 14)
        if (toSump < 0) {
          // The sump: standing water, darker towards the middle, with a pale scum line at its edge.
          set(SURFACE.water)
          toward(SURFACE.waterDeep, smooth(1.5, sump.r * 0.8, -toSump))
          toward(SURFACE.tide, 0.7 * (1 - smooth(0.3, 1.3, -toSump)))
          toward(SURFACE.floor, 0.12 * grain)
        } else if (toSump < 4 + 2 * blotch || z < floorRL - 1) {
          // Wet mud ringing the water.
          set(SURFACE.wet)
          toward(SURFACE.floor, 0.4 * smooth(1, 5, toSump) + 0.15 * grain)
        } else if (rd < half - 3) {
          // The haul ramp: a pale running surface worn into two lanes of wheel ruts.
          set(SURFACE.road)
          toward(SURFACE.cleared, 0.25 * grain)
          const d = rd + 0.9 * (valueNoise(px / 30, py / 30, seed + 89) - 0.5)
          const rut = Math.max(
            1 - smooth(0.3, 0.9, Math.abs(d - 3.6)),
            1 - smooth(0.3, 0.9, Math.abs(d - 9.2)),
          )
          toward(SURFACE.wear, 0.35 * (1 - rut))
          toward(SURFACE.rut, 0.7 * rut)
        } else if (rd < half - 2.2 + 3 * valueNoise(px / 4, py / 4, seed + 97)) {
          // Its edge is not a clean line: broken rock where the road meets the face.
          set(SURFACE.spoil)
          toward(SURFACE.rockGrey, 0.5 * valueNoise(px / 1.7, py / 1.7, seed + 101))
          local = 0.86 + 0.24 * valueNoise(px / 2.3, py / 2.3, seed + 103)
        } else if (onFloor || onBerm) {
          if (onFloor) {
            // The floor: wet and dry patches, compacted haul lanes, spoil spread at the toes.
            set(SURFACE.floor)
            toward(SURFACE.berm, 0.25 * grain)
            const damp = 0.7 * valueNoise(px / 24, py / 24, seed + 71) + 0.3 * blotch
            const wet = smooth(0.52, 0.68, damp)
            toward(SURFACE.wet, 0.75 * wet)
            toward(SURFACE.cleared, 0.45 * smooth(0.42, 0.28, damp))
            const lane = valueNoise(px / 55, py / 8, seed + 73)
            toward(SURFACE.wear, 0.4 * smooth(0.6, 0.72, lane) * (1 - wet))
            const toToe = k >= 0 ? benchS - floorStart[k] : Infinity
            const reach = 4 + 6 * valueNoise(px / 14, py / 14, seed + 79)
            if (toToe < reach) {
              const lump = valueNoise(px / 1.8, py / 1.8, seed + 83)
              toward(
                SURFACE.spoil,
                (1 - smooth(reach * 0.4, reach, toToe)) * (0.35 + 0.5 * smooth(0.45, 0.7, lump)),
              )
              local = 0.9 + 0.2 * lump
            }
          } else {
            // A berm: graded back so water drains to the toe of the face above, where it leaves
            // a damp strip; loose rock spills at that toe; a lighter track runs along the middle;
            // the crest above the next face is broken grey rock.
            set(SURFACE.berm)
            toward(SURFACE.cleared, 0.3 * blotch)
            const fromToe =
              into >= FACE_RUN_M ? into - FACE_RUN_M : into < FACE_RUN_M / 2 ? BERM_WIDTH_M : 0
            toward(SURFACE.wet, 0.4 * (1 - smooth(0.6, 2.2 + blotch, fromToe)))
            const lump = valueNoise(px / 1.6, py / 1.6, seed + 67)
            if (fromToe < 1.4 + 1.4 * blotch && lump > 0.6) {
              toward(SURFACE.spoil, 0.7)
              local = 0.85 + 0.25 * lump
            }
            const track = 1 - smooth(0.9, 1.8, Math.abs(fromToe - 4.6 - 0.8 * (grain - 0.5)))
            toward(SURFACE.wear, 0.45 * track)
            toward(SURFACE.rockGrey, 0.25 * smooth(6.6, 8, fromToe))
          }
        } else {
          // Faces: banded iron formation. Layers follow elevation, wander along the wall and
          // split into finer laminae.
          const zb = z + 5 * (valueNoise(px / 70, py / 70, seed + 53) - 0.5) + 1.5 * (blotch - 0.5)
          const band = Math.sin(zb * 0.55 + blotch * 1.6)
          const lam = Math.sin(zb * 2.1 + 1.3 * Math.sin(px / 23 + py / 31))
          set(SURFACE.rockOchre)
          toward(SURFACE.rockRed, smooth(0.1, 0.9, band) * 0.8)
          toward(SURFACE.rockGrey, smooth(-0.4, -0.9, band) * 0.6 + 0.12 * grain)
          toward(SURFACE.rockDark, smooth(0.55, 0.95, lam) * 0.15)
          toward(SURFACE.rockPale, smooth(-0.55, -0.95, lam) * 0.3)
          // Aspect: walls facing the sun oxidise redder, walls in shade weather greyer.
          const gx = bil(gradX)
          const gy = bil(gradY)
          const gl = Math.hypot(gx, gy) || 1
          const facing = -(gx * SUN.x + gy * SUN.y) / gl
          toward(SURFACE.rockRed, 0.22 * Math.max(0, facing))
          toward(SURFACE.rockGrey, 0.2 * Math.max(0, -facing))
          // Slope: gentler faces hold dust and scree, the steepest show fresh grey rock.
          toward(SURFACE.berm, 0.35 * (1 - smooth(18, 40, s)))
          toward(SURFACE.rockGrey, 0.15 * smooth(42, 60, s))
          // Jointing: blocks a few metres across, split by darker fractures.
          const joint = valueNoise(px / 3.4, py / 3.4, seed + 57)
          toward(SURFACE.rockDark, 0.3 * (1 - smooth(0.015, 0.05, Math.abs(joint - 0.5))))
          local = 0.9 + 0.2 * valueNoise(px / 6, py / 6, seed + 59)
        }
      } else if (cut > 0.4) {
        // Fresh cuts outside the pit (encroachment, scrape): raw red earth.
        set(SURFACE.freshCut)
        toward(SURFACE.soil, 0.3 * grain)
      } else {
        const toRoad = bil(road)
        const toCreek = bil(creek)
        if (toCreek < 9 + 4 * blotch) {
          // Dry creek bed: pale sand with darker gravel bars.
          set(SURFACE.creekSand)
          toward(SURFACE.soil, 0.35 * grain)
        } else if (toRoad < 8) {
          set(SURFACE.road)
          toward(SURFACE.cleared, 0.25 * grain)
          // Windrows: graded spoil heaped along both road edges.
          if (toRoad > 5.5) toward(SURFACE.soil, 0.45)
        } else {
          // Vegetation density from large-scale noise. Scrub dominates; soil shows through
          // in thin patches; scattered tree crowns (2–3 px) where it is greener.
          // Trees crowd the creek banks, where water lingers after rain.
          const riparian = 1 - smooth(12, 70, toCreek)
          const v = bil(veg) + 0.3 * (blotch - 0.5) + 0.9 * riparian
          const crowns = crownAt(px, py)
          set(SURFACE.soil)
          toward(SURFACE.grass, smooth(-0.62, -0.3, v))
          toward(SURFACE.scrub, smooth(-0.15, 0.3, v) * 0.85)
          const crownLevel = 0.74 - 0.12 * smooth(-0.2, 0.4, v) - 0.2 * riparian
          if (crowns > crownLevel) {
            toward(SURFACE.trees, 0.75)
          } else if (crownAt(px - 2.6, py + 2.6) > crownLevel) {
            // Shadow of a crown to the north-west (the sun's side), cast south-east.
            toward(SURFACE.shadow, 0.5)
          }
          // Steeper natural slopes shed soil and show it.
          toward(SURFACE.soil, smooth(8, 18, s) * 0.4)
          // Cleared, compacted ground around the pit fades out irregularly.
          const clearing = smooth(-70, -25, inPit + 30 * (blotch - 0.5) + 8 * (grain - 0.5))
          toward(SURFACE.cleared, clearing * 0.9)
        }
      }

      const shade =
        Math.min(1.1, Math.max(0.72, 1 - bil(hollow) * 9)) * (0.93 + 0.12 * grain) * local
      const o = (j * size + i) * 4
      rgba[o] = Math.min(255, cr * shade)
      rgba[o + 1] = Math.min(255, cg * shade)
      rgba[o + 2] = Math.min(255, cb * shade)
      rgba[o + 3] = 255
    }
  }
  return { width: size, height: size, rgba, provenance: 'simulated' }
}

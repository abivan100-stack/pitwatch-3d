import type { ComplianceFinding, GridSpec, Polygon, Vec2 } from '../domain/types'

/**
 * Layout of the Overview site plan: where each finding badge and each zone label goes. Pure, so
 * the placement rules are unit-tested rather than only seen in a browser.
 *
 * Three coordinate spaces meet here, and every conversion goes through `planProjection`:
 * - world: local metres, x east, y north (what the data is in);
 * - pixel: CSS pixels from the plan's top-left corner, y down (where collisions are decided);
 * - SVG: the plan's viewBox, where x is world x and y is `top − world y`.
 * Badge positions are stored in world metres for both axes; the component converts them to SVG
 * with `svgY` when it draws. Mixing spaces inside one value is how the badges were once drawn
 * mirrored about the middle of the plan.
 */

export const PIN_RADIUS_PX = 22.25
export const PIN_LABEL_HEIGHT_PX = 18
export const PIN_LABEL_GAP_PX = 5
const PIN_LABEL_CHAR_PX = 6.5
const PIN_CLEARANCE_PX = 4
const OBSERVED_LABEL_CHAR_PX = 6.5
const OBSERVED_LABEL_HEIGHT_PX = 24
const LABEL_SEARCH_STEP_PX = 4
export const OBSERVED_EXCAVATION_LABEL = 'Pit excavation'
export const OBSERVED_FILL_LABEL = 'In-zone waste fill'
export const LEASE_LABEL_TEXT = 'Lease boundary'

export interface PlanProjection {
  /** World metres per CSS pixel. */
  unitsPerPixel: number
  /** World x of the plan's left edge, and world y of its top edge. */
  x0: number
  top: number
  widthPx: number
  heightPx: number
  worldToPx: (p: Vec2) => Vec2
  pxToWorld: (p: Vec2) => Vec2
  /** World y to the SVG viewBox y (x needs no conversion). */
  svgY: (worldY: number) => number
}

/** The one mapping between world metres, plan pixels and the SVG viewBox. */
export function planProjection(grid: GridSpec, widthPx: number): PlanProjection {
  const unitsPerPixel = (grid.cols * grid.cellSize) / widthPx
  const x0 = grid.originXY.x - grid.cellSize / 2
  const top = grid.originXY.y + (grid.rows - 1) * grid.cellSize + grid.cellSize / 2
  return {
    unitsPerPixel,
    x0,
    top,
    widthPx,
    heightPx: (grid.rows * grid.cellSize) / unitsPerPixel,
    worldToPx: (p) => ({ x: (p.x - x0) / unitsPerPixel, y: (top - p.y) / unitsPerPixel }),
    pxToWorld: (p) => ({ x: x0 + p.x * unitsPerPixel, y: top - p.y * unitsPerPixel }),
    svgY: (worldY) => top - worldY,
  }
}

export interface PlannedPin {
  finding: ComplianceFinding
  /** Badge centre in world metres. */
  worldX: number
  worldY: number
  /** True when the badge was moved off its centroid, so the plan draws a leader. */
  displaced: boolean
  labelOnLeft: boolean
  /** Width of the id chip, world metres. */
  labelWidth: number
}

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

const labelWidthPx = (finding: ComplianceFinding) => finding.id.length * PIN_LABEL_CHAR_PX + 10

/** Pixel box a badge and its id chip occupy, centred on (x, y). */
export function boundsForPin(x: number, y: number, width: number, labelOnLeft: boolean): Box {
  const labelLeft = labelOnLeft
    ? x - PIN_RADIUS_PX - PIN_LABEL_GAP_PX - width
    : x + PIN_RADIUS_PX + PIN_LABEL_GAP_PX
  const labelRight = labelOnLeft
    ? x - PIN_RADIUS_PX - PIN_LABEL_GAP_PX
    : x + PIN_RADIUS_PX + PIN_LABEL_GAP_PX + width
  return {
    left: Math.min(x - PIN_RADIUS_PX, labelLeft),
    right: Math.max(x + PIN_RADIUS_PX, labelRight),
    top: Math.min(y - PIN_RADIUS_PX, y - PIN_LABEL_HEIGHT_PX / 2),
    bottom: Math.max(y + PIN_RADIUS_PX, y + PIN_LABEL_HEIGHT_PX / 2),
  }
}

/** Boxes closer than the clearance count as touching. */
export function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right + PIN_CLEARANCE_PX &&
    a.right + PIN_CLEARANCE_PX > b.left &&
    a.top < b.bottom + PIN_CLEARANCE_PX &&
    a.bottom + PIN_CLEARANCE_PX > b.top
  )
}

/** Candidate badge offsets in CSS pixels, nearest first. */
const OFFSETS = [
  [0, 0],
  [0, -34],
  [0, 34],
  [38, -18],
  [-38, -18],
  [38, 18],
  [-38, 18],
  [0, -70],
  [0, 70],
  [78, 0],
  [-78, 0],
  [78, -52],
  [-78, -52],
  [78, 52],
  [-78, 52],
  [0, -108],
  [0, 108],
] as const

/** Place pin labels and 44 px hit circles in CSS-pixel space, independent of the map scale. */
export function placePins(
  findings: readonly ComplianceFinding[],
  grid: GridSpec,
  widthPx: number,
): PlannedPin[] {
  if (widthPx <= 0) return []
  const plan = planProjection(grid, widthPx)
  const occupied: Box[] = []
  const placed: PlannedPin[] = []

  for (const finding of findings) {
    const anchor = plan.worldToPx(finding.centroid)
    const width = labelWidthPx(finding)
    const preferredLeft = anchor.x > widthPx * 0.72
    const choices = OFFSETS.flatMap(([dx, dy]) => [
      { dx, dy, labelOnLeft: preferredLeft },
      { dx, dy, labelOnLeft: !preferredLeft },
    ])
    const choice = choices.find(({ dx, dy, labelOnLeft }) => {
      const box = boundsForPin(anchor.x + dx, anchor.y + dy, width, labelOnLeft)
      return (
        box.left >= 2 &&
        box.right <= widthPx - 2 &&
        box.top >= 2 &&
        box.bottom <= plan.heightPx - 2 &&
        occupied.every((other) => !intersects(box, other))
      )
    }) ?? { dx: 0, dy: 0, labelOnLeft: preferredLeft }

    const centre = { x: anchor.x + choice.dx, y: anchor.y + choice.dy }
    occupied.push(boundsForPin(centre.x, centre.y, width, choice.labelOnLeft))
    const world = plan.pxToWorld(centre)
    placed.push({
      finding,
      worldX: world.x,
      worldY: world.y,
      displaced: choice.dx !== 0 || choice.dy !== 0,
      labelOnLeft: choice.labelOnLeft,
      labelWidth: width * plan.unitsPerPixel,
    })
  }

  return placed
}

function polygonLabelPoint(polygon: Polygon): Vec2 {
  let twiceArea = 0
  let x = 0
  let y = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const cross = a.x * b.y - b.x * a.y
    twiceArea += cross
    x += (a.x + b.x) * cross
    y += (a.y + b.y) * cross
  }
  if (Math.abs(twiceArea) < 1e-6) {
    return polygon.reduce(
      (sum, p) => ({ x: sum.x + p.x / polygon.length, y: sum.y + p.y / polygon.length }),
      { x: 0, y: 0 },
    )
  }
  return { x: x / (3 * twiceArea), y: y / (3 * twiceArea) }
}

/** Start point of the lease caption: just inside the middle of the lease's longest edge. */
export function leaseLabelPoint(polygon: Polygon): Vec2 {
  const center = polygonLabelPoint(polygon)
  let longest = { a: polygon[0]!, b: polygon[1]!, length: -1 }
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length > longest.length) longest = { a, b, length }
  }
  const middle = { x: (longest.a.x + longest.b.x) / 2, y: (longest.a.y + longest.b.y) / 2 }
  const dx = center.x - middle.x
  const dy = center.y - middle.y
  const distance = Math.hypot(dx, dy) || 1
  return { x: middle.x + (dx / distance) * 18, y: middle.y + (dy / distance) * 18 }
}

/** SVG path for a world polygon, flipped into the viewBox. */
export function svgPolygonPath(polygon: Polygon, top: number): string {
  return polygon.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${top - p.y}`).join('') + 'Z'
}

function containsPoint(polygon: Polygon, point: Vec2): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside
    }
  }
  return inside
}

export interface ObservedLabel {
  id: string
  /** The changed cell the label refers to, world metres. */
  point: Vec2
  /** Where the label text is centred, world metres; differs from `point` when a leader is drawn. */
  labelPoint: Vec2
}

/** A label rectangle in world metres, centred on its point. */
interface WorldBox {
  cx: number
  cy: number
  width: number
  height: number
}

function matchingCellsIn(grid: GridSpec, mask: Uint8Array, polygon: Polygon): Vec2[] {
  const cells: Vec2[] = []
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!mask[row * grid.cols + col]) continue
      const point = {
        x: grid.originXY.x + col * grid.cellSize,
        y: grid.originXY.y + row * grid.cellSize,
      }
      if (containsPoint(polygon, point)) cells.push(point)
    }
  }
  return cells
}

function nearestToCentroid(cells: readonly Vec2[]): Vec2 {
  const centroid = cells.reduce(
    (sum, point) => ({ x: sum.x + point.x / cells.length, y: sum.y + point.y / cells.length }),
    { x: 0, y: 0 },
  )
  return cells.reduce((nearest, point) =>
    Math.hypot(point.x - centroid.x, point.y - centroid.y) <
    Math.hypot(nearest.x - centroid.x, nearest.y - centroid.y)
      ? point
      : nearest,
  )
}

/** Pixel box of a label `widthPx` wide, centred on (x, y). */
const labelBox = (x: number, y: number, widthPx: number): Box => ({
  left: x - widthPx / 2,
  right: x + widthPx / 2,
  top: y - OBSERVED_LABEL_HEIGHT_PX / 2,
  bottom: y + OBSERVED_LABEL_HEIGHT_PX / 2,
})

/** Signed separation in pixels: negative when the boxes overlap. */
function clearanceBetween(a: Box, b: Box): number {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return overlapX >= 0 && overlapY >= 0
    ? -Math.min(overlapX, overlapY)
    : Math.hypot(Math.max(0, -overlapX), Math.max(0, -overlapY))
}

/**
 * One label per zone that has classified change inside it. Labels are placed in sequence with
 * the badges, the caller's `keepClear` boxes and earlier labels as obstacles. A spot inside the
 * zone is preferred; a zone too crowded to hold the text gets the nearest clean spot and a
 * leader instead of a label drawn over what it must not cover.
 */
export function observedLabelPoints(
  grid: GridSpec,
  mask: Uint8Array,
  polygons: readonly { id: string; polygon: Polygon }[],
  avoid?: {
    pins: readonly PlannedPin[]
    svgWidth: number
    text: string
    /** Labels already placed by the caller, which this pass must not cover. */
    keepClear?: readonly WorldBox[]
  },
): ObservedLabel[] {
  if (!avoid || avoid.svgWidth <= 0) {
    return polygons.flatMap(({ id, polygon }) => {
      const cells = matchingCellsIn(grid, mask, polygon)
      if (!cells.length) return []
      const anchor = nearestToCentroid(cells)
      return [{ id, point: anchor, labelPoint: anchor }]
    })
  }

  const plan = planProjection(grid, avoid.svgWidth)
  const widthPx = avoid.text.length * OBSERVED_LABEL_CHAR_PX
  const toPixelBox = ({ cx, cy, width, height }: WorldBox): Box => {
    const c = plan.worldToPx({ x: cx, y: cy })
    const w = width / plan.unitsPerPixel
    const h = height / plan.unitsPerPixel
    return { left: c.x - w / 2, right: c.x + w / 2, top: c.y - h / 2, bottom: c.y + h / 2 }
  }
  const obstacles: Box[] = [
    ...avoid.pins.map((pin) => {
      const c = plan.worldToPx({ x: pin.worldX, y: pin.worldY })
      return boundsForPin(c.x, c.y, pin.labelWidth / plan.unitsPerPixel, pin.labelOnLeft)
    }),
    ...(avoid.keepClear ?? []).map(toPixelBox),
  ]
  const placed: Box[] = []
  const results: ObservedLabel[] = []

  for (const { id, polygon } of polygons) {
    const matching = matchingCellsIn(grid, mask, polygon)
    if (!matching.length) continue

    const anchor = nearestToCentroid(matching)
    const anchorPx = plan.worldToPx(anchor)
    let insideBest: { point: Vec2; distance: number } | null = null
    let clearBest: { point: Vec2; distance: number } | null = null
    const blocked = [...obstacles, ...placed]
    for (
      let py = 2 + OBSERVED_LABEL_HEIGHT_PX / 2;
      py < plan.heightPx - OBSERVED_LABEL_HEIGHT_PX / 2;
      py += LABEL_SEARCH_STEP_PX
    ) {
      for (
        let px = 2 + widthPx / 2;
        px < plan.widthPx - 2 - widthPx / 2;
        px += LABEL_SEARCH_STEP_PX
      ) {
        const box = labelBox(px, py, widthPx)
        if (box.left < 2 || box.right > plan.widthPx - 2 || box.top < 2) continue
        if (box.bottom > plan.heightPx - 2) continue
        const clearance = blocked.reduce(
          (minimum, obstacle) => Math.min(minimum, clearanceBetween(box, obstacle)),
          Number.POSITIVE_INFINITY,
        )
        if (clearance < PIN_CLEARANCE_PX) continue
        const distance = Math.hypot(px - anchorPx.x, py - anchorPx.y)
        const candidate = { point: plan.pxToWorld({ x: px, y: py }), distance }
        const inside = containsPoint(polygon, candidate.point)
        const best = inside ? insideBest : clearBest
        if (!best || distance < best.distance) {
          if (inside) insideBest = candidate
          else clearBest = candidate
        }
      }
    }
    const labelPoint = insideBest?.point ?? clearBest?.point ?? anchor
    const labelPx = plan.worldToPx(labelPoint)
    placed.push(labelBox(labelPx.x, labelPx.y, widthPx))
    results.push({ id, point: anchor, labelPoint })
  }

  return results
}

/**
 * The plan's zone labels: pit excavation first, then in-zone waste fill, each keeping clear of
 * the badges, the lease caption and the labels placed before it.
 */
export function placeZoneLabels(input: {
  grid: GridSpec
  excavated: Uint8Array
  filled: Uint8Array
  pitZones: readonly { id: string; polygon: Polygon }[]
  dumpZones: readonly { id: string; polygon: Polygon }[]
  pins: readonly PlannedPin[]
  svgWidth: number
  leaseLabel: Vec2 | null
}): { cut: ObservedLabel[]; fill: ObservedLabel[] } {
  const { grid, pins, svgWidth, leaseLabel } = input
  const unitsPerPixel = svgWidth ? (grid.cols * grid.cellSize) / svgWidth : 1
  const toWorldBox = (labelPoint: Vec2, text: string): WorldBox => ({
    cx: labelPoint.x,
    cy: labelPoint.y,
    width: text.length * OBSERVED_LABEL_CHAR_PX * unitsPerPixel,
    height: OBSERVED_LABEL_HEIGHT_PX * unitsPerPixel,
  })
  const leaseWidth = LEASE_LABEL_TEXT.length * OBSERVED_LABEL_CHAR_PX * unitsPerPixel
  const keepClear: WorldBox[] =
    leaseLabel === null
      ? []
      : [
          {
            // The lease label is start-anchored, so its box begins at the anchor point.
            cx: leaseLabel.x + leaseWidth / 2,
            cy: leaseLabel.y,
            width: leaseWidth,
            height: OBSERVED_LABEL_HEIGHT_PX * unitsPerPixel,
          },
        ]
  const cut = observedLabelPoints(grid, input.excavated, input.pitZones, {
    pins,
    svgWidth,
    text: OBSERVED_EXCAVATION_LABEL,
    keepClear,
  })
  const fill = observedLabelPoints(grid, input.filled, input.dumpZones, {
    pins,
    svgWidth,
    text: OBSERVED_FILL_LABEL,
    keepClear: [
      ...keepClear,
      ...cut.map(({ labelPoint }) => toWorldBox(labelPoint, OBSERVED_EXCAVATION_LABEL)),
    ],
  })
  return { cut, fill }
}

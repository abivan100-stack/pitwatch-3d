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
const ZONE_LABEL_CHAR_PX = 6.5
const ZONE_LABEL_HEIGHT_PX = 20
const LABEL_SEARCH_STEP_PX = 4
export const LEASE_LABEL_TEXT = 'Lease boundary'

/** The part of the world a plan shows, in metres. */
export interface PlanView {
  west: number
  east: number
  south: number
  north: number
}

/** The whole survey grid, cell edges included. */
export const gridView = (grid: GridSpec): PlanView => {
  const west = grid.originXY.x - grid.cellSize / 2
  const south = grid.originXY.y - grid.cellSize / 2
  return {
    west,
    east: west + grid.cols * grid.cellSize,
    south,
    north: south + grid.rows * grid.cellSize,
  }
}

/**
 * The window onto the survey the plan draws: the box around `points` plus a margin, kept inside
 * the grid. The survey is a 2 km square but the mine fills only part of it, so the plan frames the
 * mine rather than the empty ground around it.
 */
export function planView(grid: GridSpec, points: readonly Vec2[], margin = 0.08): PlanView {
  const full = gridView(grid)
  if (!points.length) return full
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const west = Math.min(...xs)
  const east = Math.max(...xs)
  const south = Math.min(...ys)
  const north = Math.max(...ys)
  const pad = Math.max(east - west, north - south) * margin
  return {
    west: Math.max(full.west, west - pad),
    east: Math.min(full.east, east + pad),
    south: Math.max(full.south, south - pad),
    north: Math.min(full.north, north + pad),
  }
}

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
export function planProjection(
  grid: GridSpec,
  widthPx: number,
  view: PlanView = gridView(grid),
): PlanProjection {
  const unitsPerPixel = (view.east - view.west) / widthPx
  const x0 = view.west
  const top = view.north
  // SVG y is measured from the grid's north edge whatever part of the grid the view shows.
  const gridNorth = gridView(grid).north
  return {
    unitsPerPixel,
    x0,
    top,
    widthPx,
    heightPx: (view.north - view.south) / unitsPerPixel,
    worldToPx: (p) => ({ x: (p.x - x0) / unitsPerPixel, y: (top - p.y) / unitsPerPixel }),
    pxToWorld: (p) => ({ x: x0 + p.x * unitsPerPixel, y: top - p.y * unitsPerPixel }),
    svgY: (worldY) => gridNorth - worldY,
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
  view?: PlanView,
): PlannedPin[] {
  if (widthPx <= 0) return []
  const plan = planProjection(grid, widthPx, view)
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

export interface ZoneInput {
  id: string
  text: string
  polygon: Polygon
}

export interface PlacedZoneLabel {
  id: string
  text: string
  /** Where the label text is centred, world metres. */
  labelPoint: Vec2
  /** The vertex of the zone outline nearest the label, world metres: the end of its leader. */
  anchor: Vec2
  /** Distance from the label centre to `anchor`, CSS pixels; the plan draws a leader when large. */
  gapPx: number
}

/** Pixel box of a label `widthPx` wide, centred on (x, y). */
const labelBox = (x: number, y: number, widthPx: number): Box => ({
  left: x - widthPx / 2,
  right: x + widthPx / 2,
  top: y - ZONE_LABEL_HEIGHT_PX / 2,
  bottom: y + ZONE_LABEL_HEIGHT_PX / 2,
})

/** Whether the segment a to b crosses or lies inside the box (Liang-Barsky clipping). */
function segmentHitsBox(a: Vec2, b: Vec2, box: Box): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  for (const [p, q] of [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const r = q / p
      if (p < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
      if (t0 > t1) return false
    }
  }
  return true
}

/** Signed separation in pixels: negative when the boxes overlap. */
function clearanceBetween(a: Box, b: Box): number {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return overlapX >= 0 && overlapY >= 0
    ? -Math.min(overlapX, overlapY)
    : Math.hypot(Math.max(0, -overlapX), Math.max(0, -overlapY))
}

/**
 * One label per permitted zone, set beside the zone and never on it. A label may not cover a
 * changed cell (excavation or fill), the inside of any zone, a badge, the lease caption or a
 * label placed before it; among the spots that pass, the one nearest the zone's outline wins.
 * A zone with no such spot gets no label rather than one drawn over what it must not cover.
 */
export function placeZoneLabels(input: {
  grid: GridSpec
  /** Non-zero where the cell is excavated or filled, in the grid's cell order. */
  changed: ArrayLike<number>
  zones: readonly ZoneInput[]
  pins: readonly PlannedPin[]
  svgWidth: number
  leaseLabel: Vec2 | null
  /** The lease outline: a label may not sit across it. */
  lease?: Polygon
  view?: PlanView
}): PlacedZoneLabel[] {
  const { grid, changed, zones, pins, svgWidth, leaseLabel } = input
  if (svgWidth <= 0) return []
  const plan = planProjection(grid, svgWidth, input.view)
  const { cols, rows, cellSize } = grid
  const west = grid.originXY.x - cellSize / 2
  const south = grid.originXY.y - cellSize / 2

  // Summed-area table of the changed cells, so "does this box touch a fill" is four reads.
  const stride = cols + 1
  const sat = new Int32Array((rows + 1) * stride)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      sat[(row + 1) * stride + col + 1] =
        (changed[row * cols + col] ? 1 : 0) +
        sat[row * stride + col + 1]! +
        sat[(row + 1) * stride + col]! -
        sat[row * stride + col]!
    }
  }
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))
  const touchesChange = (b: Box) => {
    const pad = 3
    const sw = plan.pxToWorld({ x: b.left - pad, y: b.bottom + pad })
    const ne = plan.pxToWorld({ x: b.right + pad, y: b.top - pad })
    const c0 = clamp(Math.floor((sw.x - west) / cellSize), cols - 1)
    const c1 = clamp(Math.floor((ne.x - west) / cellSize), cols - 1)
    const r0 = clamp(Math.floor((sw.y - south) / cellSize), rows - 1)
    const r1 = clamp(Math.floor((ne.y - south) / cellSize), rows - 1)
    return (
      sat[(r1 + 1) * stride + c1 + 1]! -
        sat[r0 * stride + c1 + 1]! -
        sat[(r1 + 1) * stride + c0]! +
        sat[r0 * stride + c0]! >
      0
    )
  }
  const touchesZone = (b: Box) => {
    const sw = plan.pxToWorld({ x: b.left, y: b.bottom })
    const ne = plan.pxToWorld({ x: b.right, y: b.top })
    for (const { polygon } of zones) {
      if (polygon.some((v) => v.x >= sw.x && v.x <= ne.x && v.y >= sw.y && v.y <= ne.y)) {
        return true
      }
      for (let i = 0; i <= 4; i++) {
        for (let j = 0; j <= 2; j++) {
          const p = { x: sw.x + ((ne.x - sw.x) * i) / 4, y: sw.y + ((ne.y - sw.y) * j) / 2 }
          if (containsPoint(polygon, p)) return true
        }
      }
    }
    return false
  }

  const leaseEdges = (input.lease ?? []).map((v, i, all) => ({
    a: plan.worldToPx(v),
    b: plan.worldToPx(all[(i + 1) % all.length]!),
  }))
  const crossesLease = (box: Box) => leaseEdges.some(({ a, b }) => segmentHitsBox(a, b, box))

  const obstacles: Box[] = pins.map((pin) => {
    const c = plan.worldToPx({ x: pin.worldX, y: pin.worldY })
    return boundsForPin(c.x, c.y, pin.labelWidth / plan.unitsPerPixel, pin.labelOnLeft)
  })
  if (leaseLabel) {
    // The lease caption is start-anchored, so its box begins at the anchor point.
    const c = plan.worldToPx(leaseLabel)
    obstacles.push({
      left: c.x,
      right: c.x + LEASE_LABEL_TEXT.length * ZONE_LABEL_CHAR_PX,
      top: c.y - ZONE_LABEL_HEIGHT_PX / 2,
      bottom: c.y + ZONE_LABEL_HEIGHT_PX / 2,
    })
  }

  const results: PlacedZoneLabel[] = []
  for (const zone of zones) {
    const widthPx = zone.text.length * ZONE_LABEL_CHAR_PX
    const outline = zone.polygon.map((v) => plan.worldToPx(v))
    let best: { x: number; y: number; vertex: number; distance: number } | null = null
    for (
      let py = 2 + ZONE_LABEL_HEIGHT_PX / 2;
      py < plan.heightPx - 2 - ZONE_LABEL_HEIGHT_PX / 2;
      py += LABEL_SEARCH_STEP_PX
    ) {
      for (
        let px = 2 + widthPx / 2;
        px < plan.widthPx - 2 - widthPx / 2;
        px += LABEL_SEARCH_STEP_PX
      ) {
        const box = labelBox(px, py, widthPx)
        if (touchesChange(box) || crossesLease(box)) continue
        if (obstacles.some((o) => clearanceBetween(box, o) < PIN_CLEARANCE_PX)) continue
        let vertex = 0
        let distance = Number.POSITIVE_INFINITY
        outline.forEach((v, i) => {
          const d = Math.hypot(v.x - px, v.y - py)
          if (d < distance) {
            distance = d
            vertex = i
          }
        })
        if (best && distance >= best.distance) continue
        if (touchesZone(box)) continue
        best = { x: px, y: py, vertex, distance }
      }
    }
    if (!best) continue
    obstacles.push(labelBox(best.x, best.y, widthPx))
    results.push({
      id: zone.id,
      text: zone.text,
      labelPoint: plan.pxToWorld({ x: best.x, y: best.y }),
      anchor: zone.polygon[best.vertex]!,
      gapPx: best.distance,
    })
  }
  return results
}

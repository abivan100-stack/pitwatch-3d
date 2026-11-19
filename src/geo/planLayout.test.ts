import { describe, expect, it } from 'vitest'
import { pointInPolygon } from './polygon'
import type { ComplianceFinding, GridSpec, Polygon } from '../domain/types'
import {
  boundsForPin,
  gridView,
  intersects,
  placeZoneLabels,
  placePins,
  planView,
  planProjection,
  type Box,
} from './planLayout'

// A 2,048 m square plan like the shipped one, drawn 512 px wide: 4 m per CSS pixel.
const grid: GridSpec = { cols: 512, rows: 512, cellSize: 4, originXY: { x: 2, y: 2 } }
const WIDTH_PX = 512

const finding = (id: string, x: number, y: number): ComplianceFinding =>
  ({ id, centroid: { x, y } }) as ComplianceFinding

const square = (x: number, y: number, size: number): Polygon => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
]

describe('plan projection', () => {
  const plan = planProjection(grid, WIDTH_PX)

  it('round-trips world metres through plan pixels', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 1234.5, y: 77.25 },
      { x: 2048, y: 2048 },
    ]) {
      const back = plan.pxToWorld(plan.worldToPx(p))
      expect(back.x).toBeCloseTo(p.x, 9)
      expect(back.y).toBeCloseTo(p.y, 9)
    }
  })

  it('puts north at the top of the plan and in the SVG', () => {
    expect(plan.worldToPx({ x: 0, y: 2048 }).y).toBeCloseTo(0, 9)
    expect(plan.worldToPx({ x: 0, y: 0 }).y).toBeCloseTo(plan.heightPx, 9)
    expect(plan.svgY(2048)).toBeCloseTo(0, 9)
    expect(plan.unitsPerPixel).toBe(4)
  })
})

describe('badge placement', () => {
  it('keeps a south-east finding in the south-east, not mirrored to the north', () => {
    const plan = planProjection(grid, WIDTH_PX)
    const [pin] = placePins([finding('R3-1', 1700, 300)], grid, WIDTH_PX)
    expect(pin).toBeDefined()
    const px = plan.worldToPx({ x: pin!.worldX, y: pin!.worldY })
    expect(px.y).toBeGreaterThan(plan.heightPx / 2)
    expect(px.x).toBeGreaterThan(WIDTH_PX / 2)
    // Alone on the plan, it sits on its centroid with no leader.
    expect(pin!.displaced).toBe(false)
    expect(pin!.worldX).toBeCloseTo(1700, 9)
    expect(pin!.worldY).toBeCloseTo(300, 9)
  })

  it('moves the second of two coincident findings so the badges do not collide', () => {
    const plan = planProjection(grid, WIDTH_PX)
    const pins = placePins(
      [finding('R1-1', 1000, 1000), finding('R1-2', 1000, 1000)],
      grid,
      WIDTH_PX,
    )
    expect(pins.map((p) => p.displaced)).toEqual([false, true])
    const boxes = pins.map((p) => {
      const c = plan.worldToPx({ x: p.worldX, y: p.worldY })
      return boundsForPin(c.x, c.y, p.labelWidth / plan.unitsPerPixel, p.labelOnLeft)
    })
    expect(intersects(boxes[0]!, boxes[1]!)).toBe(false)
  })

  it('places nothing before the plan has a width', () => {
    expect(placePins([finding('R1-1', 1000, 1000)], grid, 0)).toEqual([])
  })
})

describe('zone labels', () => {
  const plan = planProjection(grid, WIDTH_PX)
  // A block of changed cells crossing two neighbouring zones, and a third zone elsewhere.
  const changed = new Uint8Array(grid.cols * grid.rows)
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.originXY.x + col * grid.cellSize
      const y = grid.originXY.y + row * grid.cellSize
      if (y > 900 && y < 1100 && x > 700 && x < 1300) changed[row * grid.cols + col] = 1
    }
  }
  const zones = [
    { id: 'west', text: 'Main pit', polygon: square(700, 900, 200) },
    { id: 'east', text: 'East waste dump', polygon: square(1100, 900, 200) },
    { id: 'north', text: 'North dump', polygon: square(900, 1500, 160) },
  ]
  const boxOf = (text: string, labelPoint: { x: number; y: number }): Box => {
    const c = plan.worldToPx(labelPoint)
    const half = (text.length * 6.5) / 2
    return { left: c.x - half, right: c.x + half, top: c.y - 10, bottom: c.y + 10 }
  }
  const pins = placePins([finding('R2-1', 800, 1000)], grid, WIDTH_PX)
  const labels = placeZoneLabels({
    grid,
    changed,
    zones,
    pins,
    svgWidth: WIDTH_PX,
    leaseLabel: { x: 1000, y: 700 },
  })

  it('gives every zone one label', () => {
    expect(labels.map((l) => l.id)).toEqual(['west', 'east', 'north'])
  })

  it('keeps every label off the changed cells and out of every zone', () => {
    for (const label of labels) {
      const box = boxOf(label.text, label.labelPoint)
      for (const [px, py] of [
        [box.left, box.top],
        [box.right, box.top],
        [box.left, box.bottom],
        [box.right, box.bottom],
        [(box.left + box.right) / 2, (box.top + box.bottom) / 2],
      ] as const) {
        const w = plan.pxToWorld({ x: px, y: py })
        const col = Math.floor((w.x - (grid.originXY.x - 2)) / grid.cellSize)
        const row = Math.floor((w.y - (grid.originXY.y - 2)) / grid.cellSize)
        expect(changed[row * grid.cols + col], `${label.id} covers a changed cell`).toBe(0)
        for (const zone of zones) {
          expect(pointInPolygon(w, zone.polygon), `${label.id} sits inside ${zone.id}`).toBe(false)
        }
      }
    }
  })

  it('keeps labels clear of each other, the badge and the lease caption', () => {
    const boxes = labels.map((l) => boxOf(l.text, l.labelPoint))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(intersects(boxes[i]!, boxes[j]!)).toBe(false)
      }
    }
    const pin = pins[0]!
    const c = plan.worldToPx({ x: pin.worldX, y: pin.worldY })
    const badge = boundsForPin(c.x, c.y, pin.labelWidth / plan.unitsPerPixel, pin.labelOnLeft)
    const lease = plan.worldToPx({ x: 1000, y: 700 })
    const caption = {
      left: lease.x,
      right: lease.x + 14 * 6.5,
      top: lease.y - 10,
      bottom: lease.y + 10,
    }
    for (const box of boxes) {
      expect(intersects(box, badge)).toBe(false)
      expect(intersects(box, caption)).toBe(false)
    }
  })

  it('sets a label beside its own zone, with the leader ending on that zone outline', () => {
    const west = labels.find((l) => l.id === 'west')!
    expect(zones[0]!.polygon).toContainEqual(west.anchor)
    expect(west.gapPx).toBeLessThan(40)
  })

  it('labels nothing before the plan has a width', () => {
    expect(
      placeZoneLabels({ grid, changed, zones, pins: [], svgWidth: 0, leaseLabel: null }),
    ).toEqual([])
  })
})

describe('plan view', () => {
  it('frames the points with a margin and never leaves the grid', () => {
    const view = planView(grid, [
      { x: 400, y: 600 },
      { x: 1400, y: 1500 },
    ])
    // The larger side is 1,000 m, so the margin is 8% of that: 80 m.
    expect(view).toEqual({ west: 320, east: 1480, south: 520, north: 1580 })
    const edge = planView(grid, [
      { x: 10, y: 10 },
      { x: 500, y: 500 },
    ])
    expect(edge.west).toBe(0)
    expect(edge.south).toBe(0)
    expect(planView(grid, [])).toEqual(gridView(grid))
  })

  it('keeps world, pixel and SVG positions in step when the view is a part of the grid', () => {
    const view = planView(grid, [
      { x: 400, y: 600 },
      { x: 1400, y: 1500 },
    ])
    const plan = planProjection(grid, 580, view)
    expect(plan.unitsPerPixel).toBeCloseTo(2, 9)
    expect(plan.worldToPx({ x: view.west, y: view.north })).toEqual({ x: 0, y: 0 })
    const p = { x: 900, y: 1000 }
    const back = plan.pxToWorld(plan.worldToPx(p))
    expect(back.x).toBeCloseTo(p.x, 9)
    expect(back.y).toBeCloseTo(p.y, 9)
    // SVG y is still measured from the grid's north edge, whatever the view shows.
    expect(plan.svgY(2048)).toBeCloseTo(0, 9)
    expect(plan.svgY(1000)).toBeCloseTo(1048, 9)
  })

  it('places a badge on its finding inside the framed view', () => {
    const view = planView(grid, [
      { x: 400, y: 600 },
      { x: 1400, y: 1500 },
    ])
    const [pin] = placePins([finding('R1-1', 900, 1000)], grid, 580, view)
    expect(pin!.displaced).toBe(false)
    expect(pin!.worldX).toBeCloseTo(900, 9)
    expect(pin!.worldY).toBeCloseTo(1000, 9)
  })
})

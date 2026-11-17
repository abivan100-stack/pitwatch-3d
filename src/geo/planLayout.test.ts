import { describe, expect, it } from 'vitest'
import type { ComplianceFinding, GridSpec, Polygon } from '../domain/types'
import {
  boundsForPin,
  intersects,
  observedLabelPoints,
  placePins,
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
  // Changed cells covering two neighbouring zones.
  const mask = new Uint8Array(grid.cols * grid.rows)
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = grid.originXY.x + col * grid.cellSize
      const y = grid.originXY.y + row * grid.cellSize
      if (y > 900 && y < 1100 && x > 700 && x < 1300) mask[row * grid.cols + col] = 1
    }
  }
  const zones = [
    { id: 'west', polygon: square(700, 900, 200) },
    { id: 'east', polygon: square(920, 900, 200) },
  ]
  const textPx = 'Pit excavation'.length * 6.5
  const boxOf = (labelPoint: { x: number; y: number }): Box => {
    const c = plan.worldToPx(labelPoint)
    return {
      left: c.x - textPx / 2,
      right: c.x + textPx / 2,
      top: c.y - 12,
      bottom: c.y + 12,
    }
  }

  it('gives each changed zone a label that overlaps neither the other label nor a badge', () => {
    const pins = placePins([finding('R2-1', 800, 1000)], grid, WIDTH_PX)
    const labels = observedLabelPoints(grid, mask, zones, {
      pins,
      svgWidth: WIDTH_PX,
      text: 'Pit excavation',
    })
    expect(labels.map((l) => l.id)).toEqual(['west', 'east'])
    const [a, b] = labels.map((l) => boxOf(l.labelPoint))
    expect(intersects(a!, b!)).toBe(false)
    const pin = pins[0]!
    const c = plan.worldToPx({ x: pin.worldX, y: pin.worldY })
    const badge = boundsForPin(c.x, c.y, pin.labelWidth / plan.unitsPerPixel, pin.labelOnLeft)
    for (const box of [a!, b!]) expect(intersects(box, badge)).toBe(false)
  })

  it('labels no zone that has no changed cell', () => {
    const empty = new Uint8Array(grid.cols * grid.rows)
    expect(observedLabelPoints(grid, empty, zones)).toEqual([])
  })
})

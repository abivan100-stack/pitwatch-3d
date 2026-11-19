import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  formatDate,
  formatLat,
  formatLon,
  monthTicks,
  storyClockLabel,
} from './format'

describe('format', () => {
  it('formats ISO dates without timezone drift', () => {
    expect(formatDate('2025-11-14')).toBe('14 Nov 2025')
  })

  it('counts days between survey dates', () => {
    expect(daysBetween('2025-11-14', '2026-08-22')).toBe(281)
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0)
    expect(addDays('2025-11-14', 281)).toBe('2026-08-22')
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
  })

  it('formats hemispheres', () => {
    expect(formatLat(-23.5)).toBe('23.5000° S')
    expect(formatLon(84.3127)).toBe('84.3127° E')
  })

  it('places month ticks strictly inside the span', () => {
    const ticks = monthTicks('2025-11-14', '2026-08-22')
    expect(ticks.map((t) => t.label)).toEqual([
      'Dec',
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
    ])
    expect(ticks[0]!.t).toBeCloseTo(17 / 281, 5)
    expect(ticks.every((t) => t.t > 0 && t.t < 1)).toBe(true)
  })

  it('returns no ticks inside a single month', () => {
    expect(monthTicks('2026-03-02', '2026-03-20')).toEqual([])
  })
})

describe('storyClockLabel', () => {
  it('names the surveys at the ends and calls any blend an illustration', () => {
    const base = '2025-11-14'
    expect(storyClockLabel(0, base, 281)).toBe('281 days between surveys')
    expect(storyClockLabel(1, base, 281)).toBe(`${formatDate(addDays(base, 281))}, day 281 of 281`)
    for (const t of [0.01, 0.5, 0.999999]) {
      expect(storyClockLabel(t, base, 281)).toBe('Illustration between surveys')
    }
  })
})

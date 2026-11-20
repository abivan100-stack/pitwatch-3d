import { beforeEach, describe, expect, it } from 'vitest'
import {
  ELEVATION_RANGE,
  VIEW_DEFAULT,
  ZOOM_RANGE,
  bearingOf,
  clampView,
  describeView,
  moveView,
  resetView,
  useHomeView,
  wrapAngle,
} from './homeView'

describe('home view', () => {
  beforeEach(resetView)

  it('keeps the camera above the ground and inside the zoom range', () => {
    moveView({ elevation: -5, zoom: 0.01 })
    expect(useHomeView.getState().elevation).toBe(ELEVATION_RANGE[0])
    expect(useHomeView.getState().zoom).toBe(ZOOM_RANGE[0])
    moveView({ elevation: 9, zoom: 99 })
    expect(useHomeView.getState().elevation).toBe(ELEVATION_RANGE[1])
    expect(useHomeView.getState().zoom).toBe(ZOOM_RANGE[1])
  })

  it('wraps the azimuth so a reset never spins the long way round', () => {
    moveView({ azimuth: 7 * Math.PI })
    expect(Math.abs(useHomeView.getState().azimuth)).toBeLessThanOrEqual(Math.PI)
    expect(wrapAngle(2 * Math.PI + 0.3)).toBeCloseTo(0.3)
    expect(Math.abs(clampView({ ...VIEW_DEFAULT, azimuth: -3 * Math.PI }).azimuth)).toBeCloseTo(
      Math.PI,
    )
  })

  it('resets to the framed view', () => {
    moveView({ azimuth: 1, elevation: 0.3, zoom: 2 })
    resetView()
    expect(useHomeView.getState()).toEqual(VIEW_DEFAULT)
  })

  it('names the side the camera is on, and only changes at a readable step', () => {
    expect(bearingOf(0)).toBeCloseTo(180)
    expect(bearingOf(Math.PI / 2)).toBeCloseTo(90)
    expect(describeView(VIEW_DEFAULT)).toBe('from the south-east, 40° above the horizon, zoom 1.0×')
    expect(describeView({ ...VIEW_DEFAULT, azimuth: 0 })).toContain('from the south,')
    expect(describeView({ ...VIEW_DEFAULT, elevation: VIEW_DEFAULT.elevation + 0.01 })).toBe(
      describeView(VIEW_DEFAULT),
    )
  })
})

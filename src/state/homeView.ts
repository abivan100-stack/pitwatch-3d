import { create } from 'zustand'

/**
 * Where the landing model's camera is asked to be: an azimuth around the block (0 = looking north
 * from the south), an elevation above the horizon and a zoom (1 = the whole block in frame). The
 * model eases towards it. Drag, wheel, pinch, keys, the rotate buttons and Reset all write here.
 */
export interface HomeView {
  azimuth: number
  elevation: number
  zoom: number
}

export const VIEW_DEFAULT: HomeView = { azimuth: 0.55, elevation: 0.66, zoom: 1 }
/** About 14° to 77°: never under the ground, never quite straight down. */
export const ELEVATION_RANGE = [0.25, 1.35] as const
/** 1 frames the whole block; 4 is close enough to read benches and stays clear of the ground. */
export const ZOOM_RANGE = [1, 4] as const

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))
/** Angle in (-π, π]. */
export const wrapAngle = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI))

export function clampView(v: HomeView): HomeView {
  return {
    azimuth: wrapAngle(v.azimuth),
    elevation: clamp(v.elevation, ELEVATION_RANGE),
    zoom: clamp(v.zoom, ZOOM_RANGE),
  }
}

/** How far one key press, one rotate-button press or one zoom step moves the view. */
export const STEP = { key: 0.12, tilt: 0.08, button: 0.35, zoom: 1.25 } as const

export const useHomeView = create<HomeView>(() => ({ ...VIEW_DEFAULT }))

/** Turns the view by `azimuth` and `elevation` radians and multiplies the zoom. */
export function moveView({
  azimuth = 0,
  elevation = 0,
  zoom = 1,
}: Partial<HomeView> & { zoom?: number }) {
  const v = useHomeView.getState()
  useHomeView.setState(
    clampView({
      azimuth: v.azimuth + azimuth,
      elevation: v.elevation + elevation,
      zoom: v.zoom * zoom,
    }),
  )
}

export const resetView = () => useHomeView.setState({ ...VIEW_DEFAULT })

/** Bearing of the camera from the block, degrees clockwise from north. */
export const bearingOf = (azimuth: number) =>
  ((Math.atan2(Math.sin(azimuth), -Math.cos(azimuth)) * 180) / Math.PI + 360) % 360

const POINTS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
]

/** "from the south-east, 40° above the horizon, zoom 1×", rounded so it changes only when it reads differently. */
export function describeView(v: HomeView): string {
  const from = POINTS[Math.round(bearingOf(v.azimuth) / 45) % 8]
  const deg = Math.round((v.elevation * 180) / Math.PI / 5) * 5
  return `from the ${from}, ${deg}° above the horizon, zoom ${v.zoom.toFixed(1)}×`
}

/** Live readings the scale bar and north arrow draw from, written by the landing scene. */
export const useHomeCamera = create<{ heading: number; metresPerPixel: number }>(() => ({
  heading: 0,
  metresPerPixel: 2,
}))

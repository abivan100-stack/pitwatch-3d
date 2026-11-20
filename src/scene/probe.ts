import type { useCameraState } from './cameraState'
import type { Pose } from './presets'

/**
 * Read-only window into the camera for browser tests. It exists only when a test's init script
 * defines `window.__pitwatchProbe = { flights: [] }` before the app loads; for a visitor it is
 * undefined and nothing is recorded or exposed.
 */
export interface Probe {
  /** Every flight started: its start time and planned length (ms), and when it landed. */
  flights: {
    start: number
    ms: number
    end?: number
    /** Share of the distance the flight's own easing covers in its first 100 ms. */
    early?: number
  }[]
  /** The camera store, so a test can count its writes. */
  cameraState?: typeof useCameraState
  pose?: () => Pose
  /** Viewport position (CSS px) of the top of a finding's pin stick, where its badge hangs. */
  pinTop?: (id: string) => { x: number; y: number } | null
  /** Id of the finding the camera was last sent to by this map. */
  framed?: string
  /** The landing model's renderer: its tone mapper (three's constants; 0 is none) and frames drawn. */
  landing?: { toneMapping: number; frames: number }
}

export const probe = (globalThis as { __pitwatchProbe?: Probe }).__pitwatchProbe

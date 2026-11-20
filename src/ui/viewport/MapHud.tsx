import { useEffect, useId, useMemo, useRef, type CSSProperties } from 'react'
import { SURFACE_KEY } from '../../data/orthophoto'
import { useCameraState } from '../../scene/cameraState'
import { changeThreshold } from '../../compliance/change'
import { COMPLIANCE_CONFIG } from '../../compliance/config'
import { OVERLAY, rampGradient } from '../../scene/palette'
import { scaleBar, type ViewPreset } from '../../scene/presets'
import { elevationScale } from '../../scene/terrainGeometry'
import { EXAGGERATION, useAppStore } from '../../state/store'
import { measureOnSurface } from '../../geo/measure'
import { useTerrain } from '../../state/terrain'
import { GLYPH } from '../findings'

const delay = (s: number) => ({ '--d': `${s}s` }) as CSSProperties

const PRESETS: { id: ViewPreset; label: string }[] = [
  { id: 'oblique', label: 'Oblique' },
  { id: 'top', label: 'Top' },
  { id: 'pit', label: 'Pit' },
]

type Readings = { heading: number; metresPerPixel: number }
/** Anything with the camera store's shape: the map's, or the landing model's. */
type ReadingsStore = Pick<typeof useCameraState, 'getState' | 'subscribe'>

/** The compass rose; its needle turns with the camera's heading. Decorative: the caller names it. */
export function CompassRose({ store = useCameraState }: { store?: ReadingsStore }) {
  const needle = useRef<SVGGElement>(null)
  useEffect(() => {
    const draw = ({ heading }: Readings) =>
      needle.current?.setAttribute('transform', `rotate(${-heading})`)
    draw(store.getState())
    return store.subscribe(draw)
  }, [store])
  return (
    <svg viewBox="-20 -20 40 40" className="h-full w-full" aria-hidden="true">
      <circle r="18.5" className="compass-ring" />
      <g ref={needle}>
        <path d="M0 -14 L5 2 L0 -1 L-5 2 Z" className="compass-north" />
        <path d="M0 14 L5 -2 L0 1 L-5 -2 Z" className="compass-south" />
        <text y="-6.5" className="compass-n" transform="translate(0 -9.5)">
          N
        </text>
      </g>
    </svg>
  )
}

/** Preset camera views and a compass that turns with the camera (click to face north). */
export function ViewControls() {
  const requestView = useAppStore((s) => s.requestView)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const draw = ({ heading }: { heading: number }) => {
      button.current?.setAttribute('title', `Heading ${Math.round(heading)}°. Click to face north.`)
    }
    draw(useCameraState.getState())
    return useCameraState.subscribe(draw)
  }, [])

  return (
    <div className="enter-down absolute top-4 right-4 flex items-start gap-2" style={delay(1)}>
      <div role="group" aria-label="Camera view" className="seg">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" onClick={() => requestView(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <button
        ref={button}
        type="button"
        className="compass-btn"
        aria-label="Compass. Click to face north"
        onClick={() => requestView('north')}
      >
        <CompassRose />
      </button>
    </div>
  )
}

/** Chooses what a click on the terrain does, with a one-line prompt for the current step. */
export function ToolControls() {
  const tool = useAppStore((s) => s.tool)
  const setTool = useAppStore((s) => s.setTool)
  const a = useAppStore((s) => s.measureA)
  const b = useAppStore((s) => s.measureB)
  const picked = useAppStore((s) => s.picked)
  const clearPicks = useAppStore((s) => s.clearPicks)
  const survey = useTerrain((s) => s.surveys.current)

  const m = survey && a && b ? measureOnSurface(survey.grid, survey.elevations, a, b) : null
  // A finger taps and pinches; a pointer clicks. Say which, so the hint is never wrong.
  const touch = window.matchMedia('(pointer: coarse)').matches
  const press = touch ? 'Tap' : 'Click'
  let hint = touch
    ? 'Drag to turn, pinch to zoom, tap to read a point.'
    : 'Click the terrain to read a point.'
  if (tool === 'measure') {
    hint = !a ? `${press} point A.` : !b ? `${press} point B.` : ''
  } else if (picked) {
    hint = 'Point read. See Inspector.'
  }
  const anything = tool === 'measure' ? Boolean(a) : Boolean(picked)

  return (
    <div
      className="enter-down absolute top-[60px] left-4 flex flex-col items-start gap-2"
      style={delay(1.3)}
    >
      <div role="group" aria-label="Click tool" className="seg">
        <button type="button" aria-pressed={tool === 'inspect'} onClick={() => setTool('inspect')}>
          Inspect
        </button>
        <button
          type="button"
          aria-pressed={tool === 'measure'}
          aria-keyshortcuts="M"
          onClick={() => setTool('measure')}
        >
          Measure
        </button>
      </div>
      <div className="map-chip flex items-center gap-2 text-[11.5px] text-ink-dim" role="status">
        {m ? (
          <span className="font-mono text-ink">
            {m.horizontalDistance.toFixed(0)} m across, {m.dz >= 0 ? '+' : '−'}
            {Math.abs(m.dz).toFixed(1)} m
          </span>
        ) : (
          hint
        )}
        {anything && (
          <button
            type="button"
            className="text-accent underline underline-offset-2"
            onClick={clearPicks}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

/** Ramp positions labelled in the key. */
const KEY_TICKS = [0, 0.25, 0.5, 0.75, 1]

type KeyRow = { key: string; swatch: React.ReactNode; label: string }

/** Lines drawn on the map that are switched on: one key row each. */
function lineRows(
  layers: ReturnType<typeof useAppStore.getState>['layers'],
  limits: NonNullable<ReturnType<typeof useTerrain.getState>['limits']>,
): KeyRow[] {
  // White map lines sit on a dark chip so they stay visible on the pale panel.
  const swatch = (inner: React.CSSProperties) => (
    <span
      className="flex h-2.5 w-4 shrink-0 items-center rounded-[2px] px-0.5"
      style={{ background: 'color-mix(in srgb, var(--color-ink) 62%, transparent)' }}
    >
      <span className="w-full" style={{ height: 0, ...inner }} />
    </span>
  )
  const line = (opacity: number, h: number) =>
    swatch({ borderTop: `${h}px solid ${OVERLAY.lease}`, opacity })
  // The hairline round the surveyed grid is always drawn: it is where the real (simulated) survey
  // ends and the decorative ground around it begins.
  const rows: KeyRow[] = [
    {
      key: 'survey-edge',
      swatch: (
        <span
          className="w-4"
          style={{ height: 0, borderTop: `1.5px solid ${OVERLAY.surveyEdge}` }}
        />
      ),
      label: 'Surveyed area (simulated)',
    },
  ]
  if (layers.lease) rows.push({ key: 'lease', swatch: line(1, 3), label: 'Lease boundary' })
  if (layers.buffer) {
    rows.push({
      key: 'buffer',
      swatch: line(0.7, 1.5),
      label: `Safety buffer (${limits.safetyBufferMetres} m)`,
    })
  }
  if (layers.zones) {
    const dashed = (dash: string) => swatch({ borderTop: `2px ${dash} ${OVERLAY.lease}` })
    const many = limits.pitZones.length > 1
    for (const zone of limits.pitZones) {
      rows.push({
        key: `pit-${zone.id}`,
        swatch: dashed('dashed'),
        // One row per zone, so a second pit's floor is never mistaken for the first's.
        label: many
          ? `Pit zone ${zone.id} (floor ${zone.approvedFloorElevation} m RL)`
          : `Pit zone (floor ${zone.approvedFloorElevation} m RL)`,
      })
    }
    rows.push({ key: 'dump', swatch: dashed('dotted'), label: 'Dump zone' })
  }
  return rows
}

const box = (key: string, label: string, colour: string): KeyRow => ({
  key,
  label,
  swatch: <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: colour }} />,
})

const SEVERITIES = [
  ['warning', 'Warning'],
  ['violation', 'Violation'],
  ['critical', 'Critical'],
] as const

/**
 * The map key: a small "Map key" chip, closed on arrival at every width. It sits under the Map card
 * at the bottom of its column, or at the stage's bottom-left above the timeline when that card is
 * folded or absent (`.map-key` in index.css). It opens upward into a compact one-column card and
 * stays as the visitor left it for the session.
 */
export function MapKey() {
  const survey = useTerrain((s) => s.surveys.current)
  const limits = useTerrain((s) => s.limits)
  const change = useTerrain((s) => s.change)
  const layers = useAppStore((s) => s.layers)
  const onCurrent = useAppStore((s) => s.epoch === 'current')
  const open = useAppStore((s) => s.keyOpen)
  const toggleKey = useAppStore((s) => s.toggleKey)
  const id = useId()
  const scale = useMemo(() => survey && elevationScale(survey.elevations), [survey])
  if (!survey || !scale || !limits || !change) return null

  const tint = layers.tint || !survey.orthophoto
  const showChange = layers.change && onCurrent
  const showFindings = layers.findings && onCurrent
  // Swatch and label pairs that share a wrapped line; `wide` gives each pair a line of its own.
  const list = (rows: KeyRow[], wide = false) => (
    <ul className="flex flex-wrap gap-x-3">
      {rows.map((r) => (
        <li key={r.key} className={`map-key-row ${wide ? 'w-full' : ''}`}>
          <span aria-hidden="true" className="flex shrink-0">
            {r.swatch}
          </span>
          {r.label}
        </li>
      ))}
    </ul>
  )
  const source = [!tint && 'Simulated image', (showFindings || showChange) && 'rule-engine marks']
    .filter(Boolean)
    .join('; ')
  const notes = [
    layers.contours && 'Contours every 5 m, bold every 25 m',
    showChange &&
      `Changes under ${changeThreshold(change.sigma, COMPLIANCE_CONFIG).toFixed(2)} m are not shown (noise)`,
    source && source[0].toUpperCase() + source.slice(1),
  ].filter(Boolean)

  return (
    <section
      aria-label="Map key"
      className="map-key pointer-events-none absolute inset-x-4 bottom-24 flex justify-start max-sm:bottom-[8.25rem]"
    >
      <div className="flex flex-col items-start">
        <div
          id={id}
          data-open={open ? '' : undefined}
          className="map-key-body w-[240px] max-w-full"
        >
          <div className="map-key-inner">
            <div className="map-key-card card pointer-events-auto mb-2 px-3 py-2">
              {tint && (
                <div className="pt-1 pb-0.5">
                  <div
                    className="h-2 rounded-[1px]"
                    style={{ background: rampGradient() }}
                    aria-hidden="true"
                  />
                  <div className="mt-0.5 flex justify-between font-mono text-[12px] leading-4 text-ink-dim">
                    {KEY_TICKS.map((t) => (
                      <span key={t}>{scale.at(t).toFixed(0)}</span>
                    ))}
                  </div>
                  <div className="map-key-note">Elevation, m RL</div>
                </div>
              )}
              {!tint &&
                list(SURFACE_KEY.map((k) => box(k.label, k.label, `rgb(${k.rgb.join(' ')})`)))}
              {list(lineRows(layers, limits), true)}
              {showChange &&
                list([box('cut', 'Excavated', OVERLAY.cut), box('fill', 'Filled', OVERLAY.fill)])}
              {showFindings && (
                <ul className="flex flex-wrap gap-x-2.5">
                  {SEVERITIES.map(([tone, label]) => {
                    const Glyph = GLYPH[tone]
                    return (
                      <li key={tone} className="map-key-row map-key-sev">
                        <Glyph
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: OVERLAY[tone] }}
                        />
                        {label}
                      </li>
                    )
                  })}
                </ul>
              )}
              {notes.length > 0 && (
                <div className="mt-1.5 border-t border-line pt-1.5">
                  {notes.map((n) => (
                    <div key={n as string} className="map-key-note">
                      {n}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggleKey}
          className="map-chip map-key-btn pointer-events-auto flex items-center gap-2 text-[12px] leading-4 font-medium text-ink-dim"
        >
          Map key
          <span className="fold-caret" aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

export function ExaggerationSlider() {
  const exaggeration = useAppStore((s) => s.exaggeration)
  const setExaggeration = useAppStore((s) => s.setExaggeration)
  // The slider appears in the Map card and in the mobile drawer; each instance needs its own id
  // or the label only associates with whichever comes first in the document.
  const id = useId()
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[12.5px] text-ink-dim">
          Vertical exaggeration
        </label>
        <output htmlFor={id} className="font-mono text-[12px] text-ink">
          {exaggeration.toFixed(1)}×
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={EXAGGERATION.min}
        max={EXAGGERATION.max}
        step={0.1}
        value={exaggeration}
        onChange={(e) => setExaggeration(Number(e.target.value))}
        className="range mt-1.5 w-full"
      />
    </div>
  )
}

/** The scale bar and its label, measured at the centre of the view. */
export function ScaleReadout({
  store = useCameraState,
  maxPx = 110,
  short = false,
}: {
  store?: ReadingsStore
  maxPx?: number
  /** Leave out "at centre", for a small chip. */
  short?: boolean
}) {
  const bar = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const draw = ({ metresPerPixel }: Readings) => {
      const s = scaleBar(metresPerPixel, maxPx)
      if (bar.current) bar.current.style.width = `${s.px}px`
      if (label.current) {
        label.current.textContent = s.metres >= 1000 ? `${s.metres / 1000} km` : `${s.metres} m`
      }
    }
    draw(store.getState())
    return store.subscribe(draw)
  }, [store, maxPx])

  return (
    <>
      <div ref={bar} className="scale-bar" />
      <span className="text-[11px] whitespace-nowrap text-ink-dim">
        <span ref={label} className="font-mono text-ink" />
        {short ? null : ' at centre'}
      </span>
    </>
  )
}

/** Live scale bar chip on the map. */
export function ScaleBar() {
  // Decorative, so it never takes a click. Below `xl` the stage is too narrow to hold this chip
  // and the camera group in one row, so it drops under the timeline instead of covering a button.
  return (
    <div
      className="map-chip scale-chip enter-down pointer-events-none absolute top-4 left-4 flex items-center gap-2.5 max-xl:top-auto max-xl:bottom-24 max-sm:bottom-[8.25rem]"
      style={delay(1.2)}
      aria-hidden="true"
    >
      <ScaleReadout />
    </div>
  )
}

/** Shown while the surfaces are generated or the 3D engine downloads, or if loading failed. */
export function SceneStatus({
  error,
  label,
  onRetry,
}: {
  error?: string
  label: string
  onRetry?: () => void
}) {
  return (
    <div className="absolute inset-0 grid place-items-center" role={error ? 'alert' : 'status'}>
      <div className="card w-[260px] p-4 text-center">
        {error ? (
          <>
            <div className="cond text-[17px] font-bold text-violation">Terrain unavailable</div>
            <p className="mt-1 text-[12.5px] leading-5 text-ink-dim">{error}</p>
            {onRetry && (
              <button type="button" className="btn mt-3" onClick={onRetry}>
                Try again
              </button>
            )}
          </>
        ) : (
          <>
            <div className="cond text-[17px] font-bold text-ink">{label}</div>
            <div className="loading-strata mt-3" aria-hidden="true" />
          </>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import {
  useHomeCamera,
  STEP,
  describeView,
  moveView,
  resetView,
  useHomeView,
} from '../../state/homeView'
import { useStory } from '../../state/story'
import { useTerrain } from '../../state/terrain'
import { RULE_NAMES, toneOf } from '../findings'
import { CompassRose, ScaleReadout } from '../viewport/MapHud'
import { modelSentence, phaseOf } from './modelText'

/*
 * The landing model's input and its description. The frame is the one focusable thing: it takes
 * drag (a mouse turns and tilts it, a finger turns it, since a vertical swipe belongs to the page),
 * two-finger pinch, the wheel while it has focus (or with Ctrl, which is what a trackpad pinch
 * sends; a bare wheel over the picture scrolls the page), a double click to reset, and the keys.
 * Everything it does is a write to `useHomeView`; the scene follows.
 */

const KEYS: Record<string, () => void> = {
  ArrowLeft: () => moveView({ azimuth: STEP.key }),
  ArrowRight: () => moveView({ azimuth: -STEP.key }),
  ArrowUp: () => moveView({ elevation: STEP.tilt }),
  ArrowDown: () => moveView({ elevation: -STEP.tilt }),
  '+': () => moveView({ zoom: STEP.zoom }),
  '=': () => moveView({ zoom: STEP.zoom }),
  '-': () => moveView({ zoom: 1 / STEP.zoom }),
  _: () => moveView({ zoom: 1 / STEP.zoom }),
  '0': resetView,
}

export function ModelFrame({
  change,
  findings,
  children,
}: {
  change: boolean
  findings: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const phase = useStory((s) => phaseOf(s.t))
  const view = useHomeView(describeView)
  const label =
    `3D model of the simulated mine block. ${modelSentence(phase, change, findings)} ` +
    `Viewed ${view}. Arrow keys turn it, plus and minus zoom, 0 resets.`

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const pointers = new Map<number, { x: number; y: number }>()
    let pinch = 0
    const spread = () => {
      const [a, b] = [...pointers.values()]
      return Math.hypot(a!.x - b!.x, a!.y - b!.y)
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      el.setPointerCapture(e.pointerId)
      pinch = pointers.size === 2 ? spread() : 0
    }
    const move = (e: PointerEvent) => {
      const last = pointers.get(e.pointerId)
      if (!last) return
      const next = { x: e.clientX, y: e.clientY }
      pointers.set(e.pointerId, next)
      if (pointers.size === 2) {
        const d = spread()
        if (pinch > 0 && d > 0) moveView({ zoom: d / pinch })
        pinch = d
      } else if (pointers.size === 1) {
        // A finger's vertical movement is the page scrolling (touch-action: pan-y), so only a
        // mouse or pen tilts the model.
        moveView({
          azimuth: -(next.x - last.x) * 0.007,
          elevation: e.pointerType === 'touch' ? 0 : (next.y - last.y) * 0.005,
        })
      }
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      pinch = 0
    }
    const wheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || document.activeElement === el)) return
      e.preventDefault()
      moveView({ zoom: Math.exp(-e.deltaY * 0.0015) })
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('dblclick', resetView)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('dblclick', resetView)
    }
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    const act = !(e.ctrlKey || e.metaKey || e.altKey) && KEYS[e.key]
    if (!act) return
    e.preventDefault()
    act()
  }

  return (
    <div
      ref={ref}
      className="model-frame"
      role="img"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

/** The scale bar and north arrow, small, in the corner of the model. Decorative: the label has the view. */
export function ModelScale() {
  return (
    <div className="model-scale map-chip" aria-hidden="true">
      <span className="model-compass">
        <CompassRose store={useHomeCamera} />
      </span>
      <ScaleReadout store={useHomeCamera} maxPx={80} short />
    </div>
  )
}

/**
 * The findings the model shows, by name. The tags are drawn in the canvas, so this list is what a
 * screen reader gets in their place: one entry per tag, with its id, severity and rule.
 */
export function FindingNames({ shown }: { shown: boolean }) {
  const findings = useTerrain((s) => s.findings)
  const atCurrent = useStory((s) => s.t >= 1)
  if (!shown || !atCurrent || findings.length === 0) return null
  return (
    <ul className="sr-only" aria-label="Simulated permit findings shown on the model">
      {findings.map((f) => {
        const tone = toneOf(f)
        return (
          <li key={f.id}>
            {f.id}, {tone === 'critical' ? 'critical violation' : tone}, {RULE_NAMES[f.ruleId]}
          </li>
        )
      })}
    </ul>
  )
}

import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Vec2 } from '../domain/types'
import { useAppStore } from '../state/store'
import { useTerrain } from '../state/terrain'
import { useCameraState } from './cameraState'
import { FINDING_AIM_LIFT, findingView, onGround, PIN_HEIGHT } from './overlayGeometry'
import {
  easeInOutCubic,
  easeOutCubic,
  flightMs,
  headingOf,
  metresPerPixel,
  northUp,
  presetPose,
  rescalePose,
  type Pose,
  type V3,
} from './presets'
import { probe } from './probe'
import { BASE_RL } from './terrainGeometry'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface Flight {
  from: Pose
  to: Pose
  /** Aim heights above the ground at each end, which do not scale (see `rescalePose`). */
  fromLift: number
  toLift: number
  start: number
  ms: number
  ease: (t: number) => number
  /** Eased progress of the last frame drawn. */
  e: number
}

/**
 * Orbit/pan/zoom controls plus animated flights to the preset views.
 * @param pit     pit centre in scene x/z
 * @param floorRL approved floor RL, used to aim the camera into the pit
 */
export function CameraRig({ pit, floorRL }: { pit: Vec2; floorRL: number }) {
  const controls = useRef<OrbitControlsImpl>(null)
  const flight = useRef<Flight | null>(null)
  // Height of the aim point above the ground it frames: half a pin for a finding, else 0.
  const lift = useRef(0)
  // When a flight is cut short (by a drag or a new flight), the aim stopped part way between the
  // two lifts, at the progress of the last frame drawn.
  const settleLift = () => {
    const f = flight.current
    if (f) lift.current = f.fromLift + (f.toLift - f.fromLift) * f.e
  }
  const size = useThree((s) => s.size)
  const invalidate = useThree((s) => s.invalidate)
  const exaggeration = useAppStore((s) => s.exaggeration)
  const view = useAppStore((s) => s.view)
  const focus = useAppStore((s) => s.focus)

  const floorY = (floorRL - BASE_RL) * exaggeration

  // The HUD redraws on every write, so a flight writes the store once, when it lands.
  const publish = useCallback(() => {
    const c = controls.current
    if (!c || flight.current) return
    const camera = c.object as PerspectiveCamera
    const pos = camera.position.toArray() as V3
    const target = c.target.toArray() as V3
    useCameraState.setState({
      heading: headingOf(pos, target),
      metresPerPixel: metresPerPixel(camera.position.distanceTo(c.target), camera.fov, size.height),
    })
  }, [size.height])

  const apply = useCallback(
    (p: Pose, aimLift = 0) => {
      const c = controls.current
      if (!c) return
      lift.current = aimLift
      c.object.position.set(...p.position)
      c.target.set(...p.target)
      c.update()
      publish()
      invalidate()
    },
    [publish, invalidate],
  )

  const flyTo = useCallback(
    (to: Pose, ms: number, ease = easeInOutCubic, toLift = 0) => {
      const c = controls.current
      if (!c) return
      if (reducedMotion()) return apply(to, toLift)
      settleLift()
      flight.current = {
        from: { position: c.object.position.toArray() as V3, target: c.target.toArray() as V3 },
        to,
        fromLift: lift.current,
        toLift,
        start: performance.now(),
        ms,
        ease,
        e: 0,
      }
      lift.current = toLift
      if (probe)
        probe.flights.push({ start: flight.current.start, ms, early: ease(Math.min(1, 100 / ms)) })
      invalidate()
    },
    [apply, invalidate],
  )

  // Keep the aim point on the same ground feature when the vertical scale changes. A flight in
  // progress is rescaled too: its poses were taken at the old scale, and its next frame would
  // otherwise put the camera back on the old depth. Declared before the request effects below,
  // because React runs effects in order: when a request and a scale change land in one render,
  // the camera is rescaled first and the new flight is then built at the new scale throughout.
  const lastEx = useRef(exaggeration)
  useEffect(() => {
    const c = controls.current
    if (!c || lastEx.current === exaggeration) return
    const k = exaggeration / lastEx.current
    const now = rescalePose(
      { position: c.object.position.toArray() as V3, target: c.target.toArray() as V3 },
      k,
      lift.current,
    )
    c.object.position.set(...now.position)
    c.target.set(...now.target)
    const f = flight.current
    if (f) {
      f.from = rescalePose(f.from, k, f.fromLift)
      f.to = rescalePose(f.to, k, f.toLift)
    }
    lastEx.current = exaggeration
    c.update()
    publish()
    invalidate()
  }, [exaggeration, publish, invalidate])

  // Opening shot: start high above the pit and settle into the oblique view.
  // Only on mount; later changes go through the view requests below.
  const floorYAtMount = useRef(floorY)
  const introDone = useRef(false)
  useEffect(() => {
    if (introDone.current) return
    introDone.current = true
    apply(presetPose('intro', pit, floorYAtMount.current))
    flyTo(presetPose('oblique', pit, floorYAtMount.current), 2600)
  }, [apply, flyTo, pit])

  useEffect(() => {
    if (view.n === 0) return
    const c = controls.current
    if (!c) return
    if (view.kind === 'north') {
      flyTo(northUp(c.object.position.toArray() as V3, c.target.toArray() as V3), 900)
    } else {
      flyTo(presetPose(view.kind, pit, floorY), view.kind === 'intro' ? 2600 : 1300)
    }
    // Only react to new requests, not to exaggeration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.n])

  // Fly to a finding. Every entry point (the Findings lists, the pins, the Inspector's links and
  // `?finding=` addresses) only names the finding, so they all get this same view and flight.
  useEffect(() => {
    if (!focus) return
    const c = controls.current
    const { surveys, findings } = useTerrain.getState()
    const f = findings.find((x) => x.id === focus.id)
    if (!c || !surveys.current || !f) return
    const to = findingView(surveys.current, f, exaggeration)
    const from = { position: c.object.position.toArray() as V3, target: c.target.toArray() as V3 }
    flyTo(to, flightMs(from, to), easeOutCubic, FINDING_AIM_LIFT)
    if (probe) probe.framed = f.id
    // Only react to new requests, not to exaggeration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n])

  useEffect(publish, [publish])

  const get = useThree((s) => s.get)
  useEffect(() => {
    if (!probe) return
    const project = (p: V3) => {
      const { camera, gl } = get()
      const v = new Vector3(...p).project(camera)
      const r = gl.domElement.getBoundingClientRect()
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
    }
    probe.cameraState = useCameraState
    probe.pose = () => {
      const c = controls.current!
      return { position: c.object.position.toArray() as V3, target: c.target.toArray() as V3 }
    }
    probe.pinTop = (id) => {
      const { surveys, findings } = useTerrain.getState()
      const f = findings.find((x) => x.id === id)
      if (!f || !surveys.current) return null
      const ex = useAppStore.getState().exaggeration
      return project(onGround(surveys.current, f.centroid, ex, PIN_HEIGHT))
    }
    return () => {
      delete probe!.pose
      delete probe!.pinTop
      delete probe!.framed
    }
  }, [get])

  useFrame(() => {
    const f = flight.current
    const c = controls.current
    if (!f || !c) return
    const t = Math.min(1, (performance.now() - f.start) / f.ms)
    const e = (f.e = f.ease(t))
    const lerp = (a: V3, b: V3): V3 => [
      a[0] + (b[0] - a[0]) * e,
      a[1] + (b[1] - a[1]) * e,
      a[2] + (b[2] - a[2]) * e,
    ]
    c.object.position.set(...lerp(f.from.position, f.to.position))
    c.target.set(...lerp(f.from.target, f.to.target))
    c.update()
    if (t < 1) {
      invalidate()
      return
    }
    flight.current = null
    if (probe) probe.flights[probe.flights.length - 1].end = performance.now()
    publish()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      maxPolarAngle={1.42}
      minDistance={140}
      maxDistance={7000}
      screenSpacePanning={false}
      onStart={() => {
        // A drag ends the flight where it is.
        settleLift()
        flight.current = null
      }}
      onChange={publish}
    />
  )
}

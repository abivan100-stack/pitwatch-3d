import { Line } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ComplianceFinding, TerrainSurvey } from '../domain/types'
import { useAppStore } from '../state/store'
import { useHomeCamera, useHomeView, wrapAngle, bearingOf } from '../state/homeView'
import { useStory } from '../state/story'
import { useTerrain } from '../state/terrain'
import { buildMarks, toneOf } from './marks'
import { groundRing, leaseLine, onGround, ringRadius, type V3 } from './overlayGeometry'
import { BADGE_H, BADGE_W, badgeTexture } from './badge'
import { BACKDROP_FALLBACK, LIGHT, OVERLAY, TONE_COLOR } from './palette'
import { metresPerPixel } from './presets'
import { probe } from './probe'
import { SHADOW_HALF, SUN_POSITION } from './sun'
import { SurveyEdge } from './SurveyEdge'
import { Terrain } from './Terrain'
import { useScreenHeight } from './useScreenSize'

/*
 * The home-page model: the same simulated surveys and engine output as the monitor, in frame as a
 * whole block. A before/after slider (the story position) morphs it between the two surveys, and
 * two overlays can be laid over the current one: the measured change, and the permit findings
 * (lease line, a ring and a tag per finding). The camera follows `useHomeView`, which drag, wheel,
 * pinch, the keys and the rotate buttons all write; nothing here listens to the page.
 */

const backdrop = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--color-backdrop').trim() ||
  BACKDROP_FALLBACK

/** Slider position in time, 0 = baseline, 1 = current (read every frame). */
const readTime = () => useStory.getState().t

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Tag height on screen, pixels, at most this and smaller on a small canvas. */
const TAG_PX = 24
/** How far a tag floats above its ring, scene units. */
const TAG_LIFT = 42

/**
 * A finding on the ground: a ring round it, and a small tag (severity shape and id) a little above.
 * The tag is the map's badge, so a visitor who goes on to the 3D map sees the same mark. Every
 * other tag hangs to the left of its stem, so findings close together sit side by side.
 */
function FindingMark({
  f,
  survey,
  ex,
  left,
}: {
  f: ComplianceFinding
  survey: TerrainSurvey
  ex: number
  left: boolean
}) {
  const tone = toneOf(f)
  const color = TONE_COLOR[tone]
  const ring = useMemo(
    () => groundRing(survey, f.centroid, ringRadius(f.areaM2), ex),
    [survey, f.centroid, f.areaM2, ex],
  )
  const [x, y, z] = onGround(survey, f.centroid, ex, 0)
  const map = useMemo(() => badgeTexture(tone, f.id), [tone, f.id])
  useEffect(() => () => map.dispose(), [map])
  const canvasHeight = useThree((s) => s.size.height)
  const h = useScreenHeight(Math.min(TAG_PX, Math.max(16, canvasHeight / 14)))
  return (
    <group>
      {/* Paper halo under the tone ring, drawn first, so the ring reads on any ground. */}
      <Line points={ring} color={OVERLAY.lease} lineWidth={4.5} renderOrder={1} />
      <Line points={ring} color={color} lineWidth={2.4} renderOrder={2} />
      <Line
        points={[
          [x, y, z],
          [x, y + TAG_LIFT, z],
        ]}
        color={color}
        lineWidth={1.4}
      />
      <sprite
        position={[x, y + TAG_LIFT, z]}
        center={[left ? 0.88 : 0.12, 0]}
        scale={[h * (BADGE_W / BADGE_H), h, 1]}
        renderOrder={10}
      >
        {/* Not tone mapped, so the tag reads in the same colours as on the 3D map. */}
        <spriteMaterial
          map={map}
          sizeAttenuation={false}
          depthTest={false}
          transparent
          toneMapped={false}
        />
      </sprite>
    </group>
  )
}

/** The lease boundary as a tube lying on the ground, so it reads as a line drawn on the site. */
function LeaseTube({ points }: { points: V3[] }) {
  const geometry = useMemo(() => {
    const pts = points
      .map((p) => new THREE.Vector3(...p))
      .filter((p, i, all) => i === 0 || p.distanceTo(all[i - 1]!) > 1e-6)
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1]!, pts[i]!))
    return new THREE.TubeGeometry(path, Math.ceil(path.getLength() / 12), 6, 6, false)
  }, [points])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={OVERLAY.lease} roughness={0.55} />
    </mesh>
  )
}

/** Half the diagonal of the 2048 m block: the circle its corners sweep while turning. */
const SWEEP = Math.hypot(1024, 1024)
/** Block thickness in scene units at 1.5× (ground to the base of the sides). */
const THICKNESS = 260

/**
 * Orbit around the block centre, easing towards `useHomeView`. The framed distance is recomputed
 * from the canvas size and the elevation each frame, so at zoom 1 the whole block, corners
 * included, is in frame at every angle and aspect ratio; zoom divides it.
 */
function Orbit({ target }: { target: [number, number, number] }) {
  const now = useRef({ ...useHomeView.getState() })
  const sent = useRef({ mpp: 0, heading: -1 })

  useFrame(({ camera, size }, dt) => {
    if (probe?.landing) probe.landing.frames++
    const want = useHomeView.getState()
    const a = now.current
    const k = reducedMotion() ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 10)
    a.azimuth += wrapAngle(want.azimuth - a.azimuth) * k
    a.elevation += (want.elevation - a.elevation) * k
    a.zoom *= Math.pow(want.zoom / a.zoom, k)

    const cam = camera as THREE.PerspectiveCamera
    const v = THREE.MathUtils.degToRad(cam.fov) / 2
    const h = Math.atan(Math.tan(v) * (size.width / size.height))
    const halfH = SWEEP * Math.sin(a.elevation) + (THICKNESS / 2) * Math.cos(a.elevation)
    // Fit the wider of the two, plus room for the near corners looming larger.
    const framed = Math.max(SWEEP / Math.tan(h), halfH / Math.tan(v)) + SWEEP * 0.2
    const d = framed / a.zoom
    const flat = d * Math.cos(a.elevation)
    camera.position.set(
      target[0] + Math.sin(a.azimuth) * flat,
      target[1] + d * Math.sin(a.elevation),
      target[2] + Math.cos(a.azimuth) * flat,
    )
    camera.lookAt(target[0], target[1], target[2])

    // The scale bar and north arrow read these straight into the DOM; write only on a change.
    const mpp = metresPerPixel(d, cam.fov, size.height)
    const heading = (bearingOf(a.azimuth) + 180) % 360
    if (
      Math.abs(mpp / sent.current.mpp - 1) > 0.002 ||
      Math.abs(heading - sent.current.heading) > 0.2
    ) {
      sent.current = { mpp, heading }
      useHomeCamera.setState({ metresPerPixel: mpp, heading })
    }
  })
  return null
}

/** `active` false stops rendering altogether (the story is scrolled out of view). */
export default function HomeScene({
  change: showChange,
  findings: showFindings,
  active,
}: {
  change: boolean
  findings: boolean
  active: boolean
}) {
  const baseline = useTerrain((s) => s.surveys.baseline)
  const current = useTerrain((s) => s.surveys.current)
  const limits = useTerrain((s) => s.limits)
  const findings = useTerrain((s) => s.findings)
  const ex = useAppStore((s) => s.exaggeration)
  const fog = useMemo(() => backdrop(), [])
  // The overlays are the current survey measured against the baseline, so they show only there.
  const atCurrent = useStory((s) => s.t >= 1)

  const change = useTerrain((s) => s.change)
  const marks = useMemo(
    () =>
      current ? buildMarks(current.grid.cols * current.grid.rows, change, findings) : undefined,
    [current, change, findings],
  )
  const lease = useMemo(
    () => (current && limits ? leaseLine(current, limits.leaseBoundary, ex, 3) : null),
    [current, limits, ex],
  )
  // West-to-east, every other tag hangs left, as on the 3D map.
  const leftOf = useMemo(
    () =>
      new Set(
        [...findings]
          .sort((a, b) => a.centroid.x - b.centroid.x)
          .filter((_, i) => i % 2 === 0)
          .map((f) => f.id),
      ),
    [findings],
  )
  // Middle of the block: grid centre, halfway down its visible thickness.
  const target = useMemo<[number, number, number] | null>(
    () => (current ? [0, -60 * ex, 0] : null),
    [current, ex],
  )

  if (!baseline || !current || !target) return null
  const overlay: [number, number] = [
    showChange && atCurrent ? 1 : 0,
    showFindings && atCurrent ? 1 : 0,
  ]

  return (
    <Canvas
      shadows="percentage"
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 2]}
      camera={{ fov: 35, near: 10, far: 16000, position: [0, 3000, 2000] }}
      gl={{ antialias: true, alpha: true }}
      style={{ touchAction: 'pan-y' }}
      onCreated={({ gl }) => {
        if (probe) probe.landing = { toneMapping: gl.toneMapping, frames: 0 }
      }}
    >
      <fog attach="fog" args={[fog, 5200, 12000]} />
      <hemisphereLight args={[LIGHT.sky, LIGHT.ground, 0.95]} />
      <directionalLight
        position={[...SUN_POSITION]}
        color={LIGHT.sun}
        intensity={2.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_HALF}
        shadow-camera-bottom={-SHADOW_HALF}
        shadow-camera-near={500}
        shadow-camera-far={6000}
        shadow-bias={-0.0004}
        shadow-normalBias={1.5}
      />
      <Terrain
        survey={baseline}
        morphTo={current}
        morph={readTime}
        marks={marks}
        overlay={overlay}
        visible
      />
      <SurveyEdge survey={current} ex={ex} />
      <group visible={showFindings && atCurrent}>
        {lease && <LeaseTube points={lease} />}
        {findings.map((f) => (
          <FindingMark key={f.id} f={f} survey={current} ex={ex} left={leftOf.has(f.id)} />
        ))}
      </group>
      <Orbit target={target} />
    </Canvas>
  )
}

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ComplianceFinding } from '../../domain/types'
import {
  LEASE_LABEL_TEXT,
  leaseLabelPoint,
  PIN_LABEL_GAP_PX,
  PIN_LABEL_HEIGHT_PX,
  PIN_RADIUS_PX,
  placePins,
  placeZoneLabels,
  planView,
  svgPolygonPath,
} from '../../geo/planLayout'
import { insetSegments } from '../../geo/polygon'
import {
  cellIndicesToSvgPath,
  cellMaskToSvgPath,
  chainSegments,
  elevationContoursToSvgPaths,
  indexContourInterval,
  polylinesToSvgPath,
} from '../../geo/sitePlan'
import { useAppStore } from '../../state/store'
import { useTerrain } from '../../state/terrain'
import { CriticalGlyph, ViolationGlyph, WarningGlyph } from '../icons'
import { GLYPH, RULE_NAMES, toneOf } from '../findings'
import { formatDate } from '../format'
import { ProvenanceTag } from '../ProvenanceTag'
import { navigateToFinding, ROUTE_HREF } from '../route'

const SCALE_BAR_M = 500
/** Contours are orientation only: no more than this many index lines across the relief. */
const MAX_CONTOUR_LEVELS = 4

/**
 * The mine plan is built from the same survey, change mask, permit limits and findings as the
 * monitor. The diagram uses north-up cell geometry so no map claim is added in the view layer.
 * `active` is the finding the visitor is pointing at elsewhere on the page (a list row); the plan
 * highlights it, and reports its own hover and focus through `onActive`.
 */
export function SitePlan({
  active,
  onActive,
}: {
  active: string | null
  onActive: (id: string | null) => void
}) {
  const mine = useTerrain((s) => s.mine)
  const current = useTerrain((s) => s.surveys.current)
  const change = useTerrain((s) => s.change)
  const limits = useTerrain((s) => s.limits)
  const findings = useTerrain((s) => s.findings)
  const selectedFinding = useAppStore((s) => s.selectedFinding)
  const svgRef = useRef<SVGSVGElement>(null)
  const [svgWidth, setSvgWidth] = useState(0)

  const grid = change?.grid
  // The plan frames the mine (the lease and every finding), not the whole 2 km survey square.
  const view = useMemo(() => {
    if (!grid || !limits) return null
    const half = grid.cellSize / 2
    const points = [...limits.leaseBoundary]
    for (const finding of findings) {
      let west = Infinity
      let east = -Infinity
      let south = Infinity
      let north = -Infinity
      for (const i of finding.cells) {
        const x = grid.originXY.x + (i % grid.cols) * grid.cellSize
        const y = grid.originXY.y + Math.floor(i / grid.cols) * grid.cellSize
        west = Math.min(west, x - half)
        east = Math.max(east, x + half)
        south = Math.min(south, y - half)
        north = Math.max(north, y + half)
      }
      if (east > west) points.push({ x: west, y: south }, { x: east, y: north })
    }
    return planView(grid, points)
  }, [findings, grid, limits])
  const width = view ? view.east - view.west : 0
  const height = view ? view.north - view.south : 0
  const top = grid ? grid.originXY.y + (grid.rows - 1) * grid.cellSize + grid.cellSize / 2 : 0
  const unitsPerCssPixel = width && svgWidth ? width / svgWidth : 1

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => setSvgWidth(svg.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [width])

  const changePaths = useMemo(() => {
    if (!change) return null
    return {
      excavated: cellMaskToSvgPath(change.grid, change.excavated),
      filled: cellMaskToSvgPath(change.grid, change.filled),
    }
  }, [change])
  const findingPaths = useMemo(
    () =>
      grid
        ? findings.map((finding) => ({ finding, d: cellIndicesToSvgPath(grid, finding.cells) }))
        : [],
    [findings, grid],
  )
  const pins = useMemo(
    () => (grid && view ? placePins(findings, grid, svgWidth, view) : []),
    [findings, grid, svgWidth, view],
  )
  const leaseLabel = useMemo(
    () => (limits ? leaseLabelPoint(limits.leaseBoundary) : null),
    [limits],
  )
  const zoneLabels = useMemo(() => {
    if (!grid || !limits || !change || !view) return []
    const name = (id: string) => mine?.approvedZones.find((zone) => zone.id === id)?.name ?? id
    const changed = new Uint8Array(grid.cols * grid.rows)
    for (let i = 0; i < changed.length; i++) {
      changed[i] = change.excavated[i] || change.filled[i] ? 1 : 0
    }
    return placeZoneLabels({
      grid,
      changed,
      zones: [...limits.pitZones, ...limits.dumpZones].map((zone) => ({
        id: zone.id,
        text: name(zone.id),
        polygon: zone.polygon,
      })),
      pins,
      svgWidth,
      leaseLabel,
      lease: limits.leaseBoundary,
      view,
    })
  }, [change, grid, leaseLabel, limits, mine, pins, svgWidth, view])
  const contour = useMemo(() => {
    if (!current) return { interval: 0, lines: [] }
    let min = Infinity
    let max = -Infinity
    for (const v of current.elevations) {
      if (v < min) min = v
      if (v > max) max = v
    }
    const interval = indexContourInterval(min, max, MAX_CONTOUR_LEVELS)
    return {
      interval,
      lines: elevationContoursToSvgPaths(current.grid, current.elevations, interval),
    }
  }, [current])
  const bufferPath = useMemo(
    () =>
      limits
        ? polylinesToSvgPath(
            chainSegments(insetSegments(limits.leaseBoundary, limits.safetyBufferMetres)),
            top,
          )
        : '',
    [limits, top],
  )
  if (!change || !limits || !current || !mine || !grid || !view) return null
  const svgY = (y: number) => top - y
  const open = (finding: ComplianceFinding) => navigateToFinding(finding.id)
  const onKey = (event: KeyboardEvent<SVGElement>, finding: ComplianceFinding) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open(finding)
  }
  const scaleWidth = `${(SCALE_BAR_M / width) * (svgWidth || 350)}px`
  const mapArea = `Plan of the mine from above: ${mine.name}, current survey ${formatDate(current.date)}. North is up. The plan shows the lease boundary, safety buffer, permitted pit and dump zones, a few elevation contours, classified change and every finding area.`
  const areaOf = new Map(findingPaths.map(({ finding, d }) => [finding.id, d]))
  const isActive = (id: string) => active === id || selectedFinding === id

  return (
    <section aria-labelledby="site-plan" className="rule-section">
      <div className="plan-title-block">
        <div className="plan-title-copy">
          <h2 id="site-plan" className="section-title">
            Site plan
          </h2>
          <span className="plan-survey-date">Current survey · {formatDate(current.date)}</span>
        </div>
        <div className="plan-instruments">
          <ProvenanceTag value="derived" />
          <a href={ROUTE_HREF.monitor} className="btn-primary">
            Explore in 3D
          </a>
        </div>
      </div>

      <figure className="site-plan-figure mt-3">
        <svg
          ref={svgRef}
          viewBox={`${view.west} ${top - view.north} ${width} ${height}`}
          className="site-plan"
          role="group"
          aria-label={mapArea}
        >
          <rect
            x={view.west}
            y={top - view.north}
            width={width}
            height={height}
            className="plan-ground"
          />

          {/* Index contours sit lowest so the change fills read over them. */}
          {contour.lines.map(({ level, d }) => (
            <path key={level} d={d} className="plan-contour" data-elevation={level} />
          ))}

          {changePaths?.excavated && (
            <path d={changePaths.excavated} className="plan-change plan-cut" fillRule="evenodd" />
          )}
          {changePaths?.filled && (
            <path d={changePaths.filled} className="plan-change plan-fill" fillRule="evenodd" />
          )}

          {limits.pitZones.map((zone) => (
            <path
              key={zone.id}
              d={svgPolygonPath(zone.polygon, top)}
              className="plan-line plan-pit"
            />
          ))}
          {limits.dumpZones.map((zone) => (
            <path
              key={zone.id}
              d={svgPolygonPath(zone.polygon, top)}
              className="plan-line plan-dump"
            />
          ))}
          {bufferPath && <path d={bufferPath} className="plan-line plan-buffer" />}
          {/* The lease governs R1 and therefore carries the strongest outline. */}
          <path d={svgPolygonPath(limits.leaseBoundary, top)} className="plan-line plan-lease" />

          {zoneLabels.map(({ id, text, labelPoint, anchor, gapPx }) => {
            const isPit = limits.pitZones.some((zone) => zone.id === id)
            return (
              <g key={`zone-label-${id}`} aria-hidden="true">
                {gapPx > 30 && (
                  <line
                    x1={anchor.x}
                    y1={svgY(anchor.y)}
                    x2={labelPoint.x}
                    y2={svgY(labelPoint.y)}
                    className={`plan-zone-leader ${isPit ? 'plan-pit-leader' : 'plan-dump-leader'}`}
                  />
                )}
                <text
                  x={labelPoint.x}
                  y={svgY(labelPoint.y)}
                  dy="0.35em"
                  fontSize={10 * unitsPerCssPixel}
                  strokeWidth={4 * unitsPerCssPixel}
                  className={`plan-zone-label ${isPit ? 'plan-pit-label' : 'plan-dump-label'}`}
                  data-zone={id}
                >
                  {text}
                </text>
              </g>
            )
          })}

          {leaseLabel && (
            <text
              x={leaseLabel.x}
              y={svgY(leaseLabel.y)}
              fontSize={10 * unitsPerCssPixel}
              strokeWidth={4 * unitsPerCssPixel}
              className="plan-lease-label"
            >
              {LEASE_LABEL_TEXT}
            </text>
          )}

          {/* One button per finding: its outline and badge together. The outline's fill takes no pointer
              events, so a finding's area never covers another finding's badge. */}
          {pins.map(
            ({ finding, worldX, worldY, displaced, labelOnLeft, labelWidth: chipWidth }) => {
              const x = worldX
              const y = svgY(worldY)
              const tone = toneOf(finding)
              const Glyph = GLYPH[tone]
              const anchorX = finding.centroid.x
              const anchorY = svgY(finding.centroid.y)
              const labelX = labelOnLeft
                ? x -
                  PIN_RADIUS_PX * unitsPerCssPixel -
                  PIN_LABEL_GAP_PX * unitsPerCssPixel -
                  chipWidth
                : x + PIN_RADIUS_PX * unitsPerCssPixel + PIN_LABEL_GAP_PX * unitsPerCssPixel
              return (
                <g key={finding.id}>
                  {displaced && (
                    <line
                      x1={anchorX}
                      y1={anchorY}
                      x2={x}
                      y2={y}
                      className={`plan-leader tone-${tone}`}
                    />
                  )}
                  <circle
                    cx={anchorX}
                    cy={anchorY}
                    r={2.5 * unitsPerCssPixel}
                    className={`plan-finding-origin tone-${tone}`}
                  />
                  <g
                    role="button"
                    tabIndex={0}
                    aria-pressed={selectedFinding === finding.id}
                    aria-label={`${finding.id}, ${RULE_NAMES[finding.ruleId]}, ${finding.status}, ${finding.severity} severity. Show on the map`}
                    className={`plan-pin tone-${tone}`}
                    data-finding={finding.id}
                    data-active={isActive(finding.id) || undefined}
                    onClick={() => open(finding)}
                    onKeyDown={(event) => onKey(event, finding)}
                    onFocus={() => onActive(finding.id)}
                    onBlur={() => onActive(null)}
                    onPointerEnter={() => onActive(finding.id)}
                    onPointerLeave={() => onActive(null)}
                  >
                    <title>{`${finding.id}: ${RULE_NAMES[finding.ruleId]}`}</title>
                    <path
                      d={areaOf.get(finding.id)}
                      data-finding={finding.id}
                      className="plan-finding-area"
                      fillRule="evenodd"
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r={PIN_RADIUS_PX * unitsPerCssPixel}
                      className="plan-pin-hit"
                    />
                    <circle cx={x} cy={y} r={10 * unitsPerCssPixel} className="plan-pin-disc" />
                    <circle
                      cx={x}
                      cy={y}
                      r={PIN_RADIUS_PX * unitsPerCssPixel}
                      className="plan-pin-ring"
                    />
                    <Glyph
                      x={x - 7 * unitsPerCssPixel}
                      y={y - 7 * unitsPerCssPixel}
                      width={14 * unitsPerCssPixel}
                      height={14 * unitsPerCssPixel}
                      className="plan-pin-glyph"
                    />
                    <rect
                      x={labelX}
                      y={y - (PIN_LABEL_HEIGHT_PX / 2) * unitsPerCssPixel}
                      width={chipWidth}
                      height={PIN_LABEL_HEIGHT_PX * unitsPerCssPixel}
                      rx={2 * unitsPerCssPixel}
                      className="plan-pin-label-bg"
                    />
                    <text
                      x={labelX + chipWidth / 2}
                      y={y + 3 * unitsPerCssPixel}
                      fontSize={10 * unitsPerCssPixel}
                      className="plan-pin-label"
                      textAnchor="middle"
                    >
                      {finding.id}
                    </text>
                  </g>
                </g>
              )
            },
          )}
        </svg>

        <ul className="plan-key" aria-label="Key to the plan">
          <li data-key="cut">
            <i className="plan-swatch plan-swatch-cut" />
            Excavation
          </li>
          <li data-key="fill">
            <i className="plan-swatch plan-swatch-fill" />
            Fill
          </li>
          <li data-key="lease">
            <i className="plan-swatch plan-swatch-lease" />
            Lease boundary
          </li>
          <li data-key="buffer">
            <i className="plan-swatch plan-swatch-buffer" />
            Safety buffer
          </li>
          <li data-key="pit">
            <i className="plan-swatch plan-swatch-pit" />
            Pit zone
          </li>
          <li data-key="dump">
            <i className="plan-swatch plan-swatch-dump" />
            Dump zone
          </li>
          <li data-key="contour">
            <i className="plan-swatch plan-swatch-contour" />
            Contour, {contour.interval} m
          </li>
          <li data-key="warning" className="tone-warning">
            <WarningGlyph className="plan-key-glyph" />
            Warning
          </li>
          <li data-key="violation" className="tone-violation">
            <ViolationGlyph className="plan-key-glyph" />
            Violation
          </li>
          <li data-key="critical" className="tone-critical">
            <CriticalGlyph className="plan-key-glyph" />
            Critical
          </li>
        </ul>

        <div className="plan-footer">
          <div className="plan-north-block" aria-label="North is up">
            <span className="plan-north-arrow" aria-hidden="true">
              ↑
            </span>
            <span>North</span>
          </div>
          <div className="plan-scale-block" aria-label={`Scale bar, ${SCALE_BAR_M} metres`}>
            <span className="plan-scale-track" style={{ width: scaleWidth }} aria-hidden="true">
              <i />
              <i />
            </span>
            <span className="plan-scale-label">{SCALE_BAR_M} m</span>
          </div>
          <p className="plan-note">
            Outlines are the engine&apos;s findings; select one to open it on the 3D map.
          </p>
        </div>
      </figure>
    </section>
  )
}

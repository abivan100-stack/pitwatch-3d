import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ComplianceFinding } from '../../domain/types'
import {
  LEASE_LABEL_TEXT,
  leaseLabelPoint,
  OBSERVED_EXCAVATION_LABEL,
  OBSERVED_FILL_LABEL,
  PIN_LABEL_GAP_PX,
  PIN_LABEL_HEIGHT_PX,
  PIN_RADIUS_PX,
  placePins,
  placeZoneLabels,
  svgPolygonPath,
} from '../../geo/planLayout'
import {
  cellIndicesToSvgPath,
  cellMaskToSvgPath,
  elevationContoursToSvgPaths,
} from '../../geo/sitePlan'
import { useAppStore } from '../../state/store'
import { useTerrain } from '../../state/terrain'
import { GLYPH, RULE_NAMES, toneOf } from '../findings'
import { formatDate } from '../format'
import { ProvenanceTag } from '../ProvenanceTag'
import { navigateToFinding, ROUTE_HREF } from '../route'

const SCALE_BAR_M = 500
const CONTOUR_INTERVAL_M = 15

/**
 * The mine plan is built from the same survey, change mask, permit limits and findings as the
 * monitor. The diagram uses north-up cell geometry so no map claim is added in the view layer.
 */
export function SitePlan() {
  const mine = useTerrain((s) => s.mine)
  const current = useTerrain((s) => s.surveys.current)
  const change = useTerrain((s) => s.change)
  const limits = useTerrain((s) => s.limits)
  const findings = useTerrain((s) => s.findings)
  const selectedFinding = useAppStore((s) => s.selectedFinding)
  const svgRef = useRef<SVGSVGElement>(null)
  const [svgWidth, setSvgWidth] = useState(0)

  const grid = change?.grid
  const width = grid ? grid.cols * grid.cellSize : 0
  const height = grid ? grid.rows * grid.cellSize : 0
  const x0 = grid ? grid.originXY.x - grid.cellSize / 2 : 0
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
    () => (grid ? placePins(findings, grid, svgWidth) : []),
    [findings, grid, svgWidth],
  )
  const leaseLabel = useMemo(
    () => (limits ? leaseLabelPoint(limits.leaseBoundary) : null),
    [limits],
  )
  const observedLabels = useMemo(
    () =>
      grid && limits
        ? placeZoneLabels({
            grid,
            excavated: change?.excavated ?? new Uint8Array(),
            filled: change?.filled ?? new Uint8Array(),
            pitZones: limits.pitZones,
            dumpZones: limits.dumpZones,
            pins,
            svgWidth,
            leaseLabel,
          })
        : { cut: [], fill: [] },
    [change, grid, leaseLabel, limits, pins, svgWidth],
  )
  const contours = useMemo(
    () =>
      current
        ? elevationContoursToSvgPaths(current.grid, current.elevations, CONTOUR_INTERVAL_M)
        : [],
    [current],
  )
  if (!change || !limits || !current || !mine || !grid) return null
  const svgY = (y: number) => top - y
  const open = (finding: ComplianceFinding) => navigateToFinding(finding.id)
  const onKey = (event: KeyboardEvent<SVGGElement>, finding: ComplianceFinding) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open(finding)
  }
  const scaleWidth = `${(SCALE_BAR_M / width) * (svgWidth || 350)}px`
  const mapArea = `Plan of the mine from above: ${mine.name}, current survey ${formatDate(current.date)}. North is up. The plan shows the lease boundary, permitted pit and dump zones, current-survey elevation contours, classified change and every finding area.`

  return (
    <section aria-labelledby="site-plan" className="rule-section">
      <div className="flex items-center justify-between gap-3">
        <h2 id="site-plan" className="section-title">
          Site plan
        </h2>
        <a href={ROUTE_HREF.monitor} className="btn-primary">
          Explore in 3D
        </a>
      </div>

      <figure className="site-plan-figure mt-3">
        <figcaption className="plan-title-block">
          <div className="plan-title-copy">
            <strong className="plan-mine-name">{mine.name}</strong>
            <span className="plan-survey-date">Current survey · {formatDate(current.date)}</span>
          </div>
          <div className="plan-instruments">
            <ProvenanceTag value="derived" />
            <div className="plan-north-block" aria-label="North is up">
              <span className="plan-north-arrow" aria-hidden="true">
                ↑
              </span>
              <span>North</span>
            </div>
            <div className="plan-scale-block" aria-label={`Scale bar, ${SCALE_BAR_M} metres`}>
              <span className="plan-scale-label">{SCALE_BAR_M} m</span>
              <span className="plan-scale-track" style={{ width: scaleWidth }} aria-hidden="true">
                <i />
                <i />
              </span>
            </div>
          </div>
        </figcaption>

        <svg
          ref={svgRef}
          viewBox={`${x0} 0 ${width} ${height}`}
          className="site-plan"
          role="group"
          aria-label={mapArea}
        >
          <rect x={x0} y={0} width={width} height={height} className="plan-ground" />

          {/* The lease governs R1 and therefore carries the strongest outline. */}
          <path d={svgPolygonPath(limits.leaseBoundary, top)} className="plan-line plan-lease" />

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

          {changePaths?.excavated && (
            <path d={changePaths.excavated} className="plan-change plan-cut" fillRule="evenodd" />
          )}
          {changePaths?.filled && (
            <path d={changePaths.filled} className="plan-change plan-fill" fillRule="evenodd" />
          )}

          {contours.map(({ level, d }) => (
            <path key={level} d={d} className="plan-contour" data-elevation={level} />
          ))}

          {findingPaths.map(({ finding, d }) => {
            const tone = toneOf(finding)
            return (
              <path
                key={finding.id}
                d={d}
                className={`plan-finding-area tone-${tone}`}
                fillRule="evenodd"
                aria-label={`${finding.id} affected area`}
              >
                <title>{`${finding.id}: cells classified as ${finding.status} by ${RULE_NAMES[finding.ruleId]}`}</title>
              </path>
            )
          })}

          {observedLabels.cut.map(({ id, point, labelPoint }) => (
            <g key={`observed-cut-${id}`}>
              {Math.hypot(labelPoint.x - point.x, labelPoint.y - point.y) > grid.cellSize / 100 && (
                <line
                  x1={point.x}
                  y1={svgY(point.y)}
                  x2={labelPoint.x}
                  y2={svgY(labelPoint.y)}
                  className="plan-observed-leader plan-observed-cut-leader"
                />
              )}
              <text
                x={labelPoint.x}
                y={svgY(labelPoint.y)}
                fontSize={10 * unitsPerCssPixel}
                strokeWidth={4 * unitsPerCssPixel}
                className="plan-observed-label plan-observed-cut-label"
                aria-label="Observed pit excavation, derived from the simulated surveys"
              >
                <title>Observed pit excavation, derived from the simulated surveys</title>
                {OBSERVED_EXCAVATION_LABEL}
              </text>
            </g>
          ))}
          {observedLabels.fill.map(({ id, point, labelPoint }) => (
            <g key={`observed-fill-${id}`}>
              {Math.hypot(labelPoint.x - point.x, labelPoint.y - point.y) > grid.cellSize / 100 && (
                <line
                  x1={point.x}
                  y1={svgY(point.y)}
                  x2={labelPoint.x}
                  y2={svgY(labelPoint.y)}
                  className="plan-observed-leader plan-observed-fill-leader"
                />
              )}
              <text
                x={labelPoint.x}
                y={svgY(labelPoint.y)}
                fontSize={10 * unitsPerCssPixel}
                strokeWidth={4 * unitsPerCssPixel}
                className="plan-observed-label plan-observed-fill-label"
                aria-label={`${OBSERVED_FILL_LABEL}, derived from the simulated surveys`}
              >
                <title>{`${OBSERVED_FILL_LABEL}, derived from the simulated surveys`}</title>
                {OBSERVED_FILL_LABEL}
              </text>
            </g>
          ))}

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
                    className={`plan-pin tone-${tone}`}
                    aria-pressed={selectedFinding === finding.id}
                    aria-label={`${finding.id}, ${RULE_NAMES[finding.ruleId]}, ${finding.status}, ${finding.severity} severity. Show on the map`}
                    onClick={() => open(finding)}
                    onKeyDown={(event) => onKey(event, finding)}
                  >
                    <title>{`${finding.id}: ${RULE_NAMES[finding.ruleId]}`}</title>
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

        <div className="plan-caption">
          <div className="plan-key" aria-label="Map symbols">
            <span>
              <i className="plan-swatch plan-swatch-cut" />
              Excavated
            </span>
            <span>
              <i className="plan-swatch plan-swatch-fill" />
              Filled
            </span>
            <span>
              <i className="plan-swatch plan-swatch-lease" />
              Lease
            </span>
            <span>
              <i className="plan-swatch plan-swatch-pit" />
              Pit permit
            </span>
            <span>
              <i className="plan-swatch plan-swatch-dump" />
              Dump permit
            </span>
            <span>
              <i className="plan-swatch plan-swatch-contour" />
              15 m contours
            </span>
          </div>
          <p className="plan-note">
            Outlined areas are the engine&apos;s findings; select a labelled glyph to open its
            evidence on the 3D map. The labels mark classified change inside a permitted pit or dump
            zone; colour marks every changed cell, so the stray heaps outside a dump zone are shown
            as well. Contours follow the current elevation survey. The loaded survey has no separate
            road layer.
          </p>
        </div>
      </figure>
    </section>
  )
}

import { useMemo, useState, type ReactNode } from 'react'
import type { ComplianceFinding, Provenance } from '../../domain/types'
import { answerLine } from '../../compliance/answer'
import { combinedSigma, K } from '../../compliance/uncertainty'
import { pitFloorRows } from '../../compliance/zone'
import { MINE_INFO, SURVEY_EPOCHS } from '../../data/fixtures/mine'
import { MINE } from '../../data/fixtures/scenario'
import { polygonArea } from '../../geo/polygon'
import { elevationRange } from '../../scene/terrainGeometry'
import { useAppStore } from '../../state/store'
import { useTerrain } from '../../state/terrain'
import { GLYPH, RULE_NAMES, toneOf, worstTone } from '../findings'
import { daysBetween, formatDate, formatLat, formatLon } from '../format'
import { ArrowRightIcon } from '../icons'
import { SitePlan } from '../panels/SitePlan'
import { ProvenanceTag } from '../ProvenanceTag'
import { navigateToFinding, ROUTE_HREF } from '../route'
import { LoadGate } from '../shell/LoadGate'
import { Page } from '../shell/AppShell'
import { useCountUp } from '../useCountUp'

const n = (v: number, digits = 0) =>
  v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** The dashboard's front page: where the mine is out of line with its permit, and what to check. */
export function OverviewPage() {
  // The finding the visitor is pointing at, in the list or on the plan; both show it.
  const [active, setActive] = useState<string | null>(null)

  return (
    <Page>
      <LoadGate>
        <Answer />
        <div className="overview-grid mt-6">
          <SitePlan active={active} onActive={setActive} />
          <Attention active={active} onActive={setActive} />
        </div>
        <Figures />
        <Details />
      </LoadGate>
    </Page>
  )
}

/** The first answer: how many findings and where the worst one is, from the engine's output. */
function Answer() {
  const findings = useTerrain((s) => s.findings)
  const lease = useTerrain((s) => s.limits?.leaseBoundary)
  const tone = worstTone(findings)
  const Glyph = tone === 'clear' ? null : GLYPH[tone]

  return (
    <section aria-labelledby="answer" className={`verdict tone-${tone}`}>
      {Glyph && <Glyph className="h-7 w-7 shrink-0 text-(--tone)" />}
      <h2 id="answer" className="cond text-[clamp(22px,2.6vw,32px)] leading-tight font-bold">
        {answerLine(findings, lease ?? [])}
      </h2>
    </section>
  )
}

/** Three headline figures, all derived from the engine's output. */
function Figures() {
  const findings = useTerrain((s) => s.findings)
  const grid = useTerrain((s) => s.change?.grid)
  const surveys = useTerrain((s) => s.surveys)
  const [baseline, current] = SURVEY_EPOCHS
  const interval = baseline && current ? daysBetween(baseline.date, current.date) : 0
  const shownDays = useCountUp(interval, 1100, 300)

  // Rock removed from ground the lease does not cover: the volume behind every R1 violation.
  const outside = findings
    .filter((f) => f.ruleId === 'R1' && f.status === 'violation')
    .reduce((sum, f) => sum + f.volumeM3, 0)
  // Findings are separate clusters of cells; a cell in two of them is counted once.
  const flaggedCells = new Set(findings.flatMap((f) => f.cells)).size
  const flaggedArea = grid ? flaggedCells * grid.cellSize * grid.cellSize : 0
  const sigma =
    surveys.baseline && surveys.current
      ? K * combinedSigma(surveys.baseline.verticalUncertainty, surveys.current.verticalUncertainty)
      : null
  const band = sigma === null ? '' : `Survey noise per cell: ± ${n(sigma, 2)} m (${K}σ).`

  return (
    <dl className="figures" aria-label="Headline figures">
      <Figure
        label="Removed outside the lease"
        value={`${n(outside)} m³`}
        note={`Behind the boundary violations. ${band}`}
        provenance="derived"
      />
      <Figure
        label="Flagged area"
        value={`${n(flaggedArea)} m²`}
        note={`Cells the findings cover. ${band}`}
        provenance="derived"
      />
      <Figure
        label="Between the surveys"
        value={`${shownDays} days`}
        note={`${baseline ? formatDate(baseline.date) : ''} to ${current ? formatDate(current.date) : ''}`}
        provenance="derived"
      />
    </dl>
  )
}

function Figure({
  label,
  value,
  note,
  provenance,
}: {
  label: string
  value: string
  note: string
  provenance?: 'derived'
}) {
  return (
    <div className="figure">
      <dt className="flex items-center justify-between gap-2 text-[13px] text-ink-dim max-sm:flex-col max-sm:items-start max-sm:gap-y-1">
        {label}
        {provenance && <ProvenanceTag value={provenance} />}
      </dt>
      <dd className="cond mt-1 text-[clamp(28px,3vw,38px)] leading-none font-bold text-ink">
        {value}
      </dd>
      <dd className="mt-1.5 text-[12px] text-ink-faint">{note}</dd>
    </div>
  )
}

/** The three most serious findings (the engine lists the most serious first). */
function Attention({
  active,
  onActive,
}: {
  active: string | null
  onActive: (id: string | null) => void
}) {
  const findings = useTerrain((s) => s.findings)
  const top = findings.slice(0, 3)

  return (
    <section aria-labelledby="attention" className="rule-section">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="attention" className="section-title">
          Look at these first
        </h2>
        <a href={ROUTE_HREF.findings} className="link-arrow">
          All {findings.length} findings
          <ArrowRightIcon className="h-4 w-4" />
        </a>
      </div>
      {top.length === 0 ? (
        <p className="mt-3 text-[14px] text-ink-dim">
          No change between the surveys breaks a permit rule.
        </p>
      ) : (
        <ul className="mt-1">
          {top.map((f) => (
            <AttentionRow key={f.id} f={f} active={active === f.id} onActive={onActive} />
          ))}
        </ul>
      )}
      <p className="mt-4 text-[12.5px] leading-5 text-ink-faint">
        Findings point to where an inspection is most needed; they do not prove a breach on their
        own.
      </p>
    </section>
  )
}

function AttentionRow({
  f,
  active,
  onActive,
}: {
  f: ComplianceFinding
  active: boolean
  onActive: (id: string | null) => void
}) {
  const tone = toneOf(f)
  const Glyph = GLYPH[tone]
  const selected = useAppStore((s) => s.selectedFinding === f.id)
  const selectFinding = useAppStore((s) => s.selectFinding)

  return (
    <li
      className={`attention tone-${tone}`}
      data-selected={selected || undefined}
      data-active={active || undefined}
      onPointerEnter={() => onActive(f.id)}
      onPointerLeave={() => onActive(null)}
      onFocus={() => onActive(f.id)}
      onBlur={() => onActive(null)}
    >
      <Glyph className="mt-0.5 h-[20px] w-[20px] shrink-0 text-(--tone)" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="text-[14.5px] font-semibold text-ink">{RULE_NAMES[f.ruleId]}</h3>
          <span className="font-mono text-[11.5px] text-ink-faint">{f.id}</span>
        </div>
        <div className="text-[12.5px] text-(--tone)">
          {f.status === 'violation' ? 'Violation' : 'Warning'}, {f.severity} severity
        </div>
        <p className="attention-text mt-1 text-[13px] leading-5 text-ink-dim">{f.explanation}</p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn"
            aria-pressed={selected}
            onClick={() => selectFinding(selected ? null : f.id)}
          >
            Highlight on plan
          </button>
          <button type="button" className="btn" onClick={() => navigateToFinding(f.id)}>
            Show on map
          </button>
        </div>
      </div>
    </li>
  )
}

/** Display names for the permit's zones: the same ones the site plan labels them with. */
const ZONE_NAME = new Map(MINE.approvedZones.map((z) => [z.id, z.name]))

/** The survey, permit and surface facts: reference material, so folded away until wanted. */
function Details() {
  const survey = useTerrain((s) => s.surveys.current)
  const limits = useTerrain((s) => s.limits)
  const [baseline, current] = SURVEY_EPOCHS
  const range = useMemo(() => survey && elevationRange(survey.elevations), [survey])
  const sigma = survey?.verticalUncertainty
  const m = MINE_INFO
  const level = (v: number | undefined) =>
    v !== undefined && sigma !== undefined ? `${v.toFixed(1)} ± ${sigma.toFixed(2)} m RL` : '—'
  // pitFloorRows keeps the floor values; the zone's display name replaces its id.
  const floors = limits
    ? pitFloorRows(limits.pitZones).map((row, i) => {
        const id = limits.pitZones[i]!.id
        return { name: ZONE_NAME.get(id) ?? id, value: row.value }
      })
    : []

  return (
    <details className="details-fold mt-8">
      <summary>Survey and permit details</summary>
      <div className="fact-groups">
        <FactGroup title="Surveys">
          <Fact label="Baseline" mono provenance="simulated">
            {baseline ? formatDate(baseline.date) : '—'}
          </Fact>
          <Fact label="Current" mono provenance="simulated">
            {current ? formatDate(current.date) : '—'}
          </Fact>
          <Fact label="Method" provenance="simulated">
            {/* The tag beside it already says simulated. */}
            {baseline?.method.replace(/ \(simulated\)$/, '') ?? '—'}
          </Fact>
          <Fact label="Grid" provenance="simulated">
            {MINE.metadata.grid}
          </Fact>
          <Fact label="Grid origin" mono provenance="simulated">
            {formatLat(m.originLatLon.lat)}, {formatLon(m.originLatLon.lon)}
          </Fact>
        </FactGroup>
        <FactGroup title="Permit">
          <Fact label="Operator" provenance="simulated">
            {m.operator}
          </Fact>
          <Fact label="Lease area" provenance="derived">
            {limits ? `${(polygonArea(limits.leaseBoundary) / 10_000).toFixed(1)} ha` : '—'}
          </Fact>
          <Fact label="Safety buffer" provenance="simulated">
            {limits ? `${limits.safetyBufferMetres} m` : '—'}
          </Fact>
          {/* One row, one line per pit; each floor carries its own tag. */}
          <Fact label="Approved floor">
            <span className="fact-lines">
              {floors.map((f) => (
                <span key={f.name} className="fact-line">
                  <span className="text-ink-dim">{f.name}</span>
                  <span className="fact-value">{f.value}</span>
                  <ProvenanceTag value="simulated" />
                </span>
              ))}
            </span>
          </Fact>
        </FactGroup>
        <FactGroup title="Surface">
          <Fact label="Lowest point" provenance="derived">
            {level(range?.min)}
          </Fact>
          <Fact label="Highest point" provenance="derived">
            {level(range?.max)}
          </Fact>
        </FactGroup>
      </div>
      <p className="mt-4 text-[13px] leading-5 text-ink-faint">
        The ground around the surveyed area on the 3D model is decorative, simulated scenery. It is
        not measured, and no figure on this page uses it.
      </p>
    </details>
  )
}

function FactGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="fact-group">
      <h3>{title}</h3>
      <dl>{children}</dl>
    </section>
  )
}

/** One fact on one line: label, value, and the value's provenance tag right after it. */
function Fact({
  label,
  mono,
  provenance,
  children,
}: {
  label: string
  /** Dates and coordinates only. */
  mono?: boolean
  /** Omit only when the children carry their own tagged values. */
  provenance?: Provenance
  children: ReactNode
}) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>
        {provenance ? (
          <>
            <span className={mono ? 'fact-value font-mono' : 'fact-value'}>{children}</span>
            <ProvenanceTag value={provenance} />
          </>
        ) : (
          children
        )}
      </dd>
    </div>
  )
}

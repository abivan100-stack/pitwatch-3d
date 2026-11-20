import { COMPLIANCE_CONFIG } from '../../compliance/config'
import type { ComplianceFinding } from '../../domain/types'
import { useAppStore } from '../../state/store'
import { useTerrain } from '../../state/terrain'
import { countText, GLYPH, RULE_NAMES, toneOf } from '../findings'
import { CriticalGlyph, ViolationGlyph, WarningGlyph } from '../icons'
import { EmptyNote, Section } from './parts'

const LEGEND = [
  {
    Glyph: WarningGlyph,
    name: 'Warning',
    tone: 'sev-warn',
    meaning: 'Possible or minor; the survey noise cannot confirm it.',
  },
  {
    Glyph: ViolationGlyph,
    name: 'Violation',
    tone: 'sev-violation',
    meaning: 'A limit is exceeded by more than the noise.',
  },
  {
    Glyph: CriticalGlyph,
    name: 'Critical',
    tone: 'sev-critical',
    meaning: 'A violation large enough to inspect first.',
  },
]

const n = (v: number, digits = 0) =>
  v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })

/**
 * One finding as a three-line row: glyph, rule and id; status with the three figures; the
 * explanation on demand beside "Show on map". The figure labels are read out but not drawn: the
 * key above the list names them once. `level` is the heading level of its title.
 */
export function FindingCard({ f, level = 4 }: { f: ComplianceFinding; level?: 3 | 4 }) {
  const Title = `h${level}` as const
  const tone = toneOf(f)
  const Glyph = GLYPH[tone]
  const selected = useAppStore((s) => s.selectedFinding === f.id)
  const selectFinding = useAppStore((s) => s.selectFinding)
  return (
    <li
      className={`finding tone-${tone}`}
      aria-current={selected || undefined}
      data-selected={selected || undefined}
    >
      <div className="flex items-center gap-2">
        <Glyph className="h-4 w-4 shrink-0 text-(--tone)" />
        <Title className="min-w-0 flex-1 text-[13px] leading-[18px] font-semibold text-ink">
          {RULE_NAMES[f.ruleId]}
        </Title>
        <span className="font-mono text-[12px] text-ink-faint">{f.id}</span>
      </div>
      <div className="finding-facts">
        <span className="font-semibold text-(--tone)">
          {f.status === 'violation' ? 'Violation' : 'Warning'} · {f.severity}
        </span>
        <span className="finding-figures">
          <span className="sr-only">Area </span>
          {n(f.areaM2)} m² · <span className="sr-only">Volume </span>
          {n(f.volumeM3)} m³ · <span className="sr-only">Max excess </span>
          {n(f.maxExceedance, 1)} m max
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <details className="frow-more">
          <summary>Why it was flagged</summary>
          <p>{f.explanation}</p>
          <p className="mt-2 font-mono text-[12px] text-ink-faint">
            Centre E {n(f.centroid.x)} m, N {n(f.centroid.y)} m
          </p>
        </details>
        <button
          type="button"
          className="shrink-0 self-start font-semibold text-accent underline underline-offset-2"
          onClick={() => selectFinding(f.id)}
        >
          Show on map
        </button>
      </div>
    </li>
  )
}

/** How a cell comes to count as changed, with the σ the engine used. */
export function ThresholdNote() {
  const ready = useTerrain((s) => s.status === 'ready')
  const sigma = useTerrain((s) => s.change?.sigma)
  const cfg = COMPLIANCE_CONFIG
  if (!ready || sigma === undefined) return null
  return (
    <p className="mt-3 text-[11.5px] leading-4 text-ink-faint">
      A cell counts as changed when it moved more than {cfg.minChangeM} m plus {cfg.k}σ (σ ={' '}
      {sigma.toFixed(2)} m for the two surveys combined). Changes below that line are not reported.
    </p>
  )
}

/** What the three severity shapes mean. */
export function SeverityLegend({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  if (compact)
    return (
      <ul className={className ? `sev-compact ${className}` : 'sev-compact'}>
        {LEGEND.map(({ Glyph, name, tone, meaning }) => (
          <li key={name} className={`sev-line ${tone}`}>
            <Glyph className="h-3.5 w-3.5 shrink-0" />
            <span>
              <b>{name}</b> <span className="sev-meaning">{meaning}</span>
            </span>
          </li>
        ))}
      </ul>
    )
  return (
    <ul className={className ?? 'space-y-2'}>
      {LEGEND.map(({ Glyph, name, tone, meaning }) => (
        <li key={name} className={`sev-row ${tone}`}>
          <Glyph className="mt-0.5 h-[18px] w-[18px] shrink-0" />
          <div>
            <div className="text-[13px] font-semibold">{name}</div>
            <div className="text-[12.5px] leading-5 text-ink-dim">{meaning}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function FindingsPanel() {
  const ready = useTerrain((s) => s.status === 'ready')
  const findings = useTerrain((s) => s.findings)

  return (
    <>
      <Section
        title={ready ? countText(findings) : 'Findings'}
        provenance={ready ? 'derived' : undefined}
      >
        {!ready ? (
          <EmptyNote>Findings appear once both surveys have loaded.</EmptyNote>
        ) : findings.length === 0 ? (
          <EmptyNote>No change between the surveys breaks a permit rule.</EmptyNote>
        ) : (
          <>
            <p className="finding-key">Area · volume · max excess</p>
            <ul className="finding-list">
              {findings.map((f) => (
                <FindingCard key={f.id} f={f} />
              ))}
            </ul>
          </>
        )}
        {ready && (
          <details className="threshold-more">
            <summary>How a change is counted</summary>
            <ThresholdNote />
          </details>
        )}
      </Section>
      <div className="divider" />
      <Section title="How findings are marked">
        <SeverityLegend compact />
      </Section>
    </>
  )
}

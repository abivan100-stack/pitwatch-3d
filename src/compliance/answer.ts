import type { ComplianceFinding, Polygon } from '../domain/types'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const POINTS = [
  'east',
  'north-east',
  'north',
  'north-west',
  'west',
  'south-west',
  'south',
  'south-east',
] as const

/** Which part of the lease a finding sits in, as an eight-point compass word, or `centre`. */
export function leaseDirection(centroid: { x: number; y: number }, lease: Polygon): string {
  if (lease.length === 0) return 'centre' // no lease to place it in
  const xs = lease.map((p) => p.x)
  const ys = lease.map((p) => p.y)
  const dx = centroid.x - (Math.min(...xs) + Math.max(...xs)) / 2
  const dy = centroid.y - (Math.min(...ys) + Math.max(...ys)) / 2
  const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  if (Math.hypot(dx, dy) < reach * 0.08) return 'centre'
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
  return POINTS[((sector % 8) + 8) % 8]!
}

/** Where the most serious finding is, in a phrase that completes "The most serious is ...". */
function placeOf(f: ComplianceFinding, lease: Polygon): string {
  const dir = leaseDirection(f.centroid, lease)
  const part = dir === 'centre' ? 'the centre' : `the ${dir}`
  switch (f.ruleId) {
    case 'R1':
      if (f.status === 'warning')
        return dir === 'centre' ? 'in the safety buffer' : `in the ${dir} safety buffer`
      return dir === 'centre' ? 'at the lease boundary' : `at the ${dir} lease boundary`
    case 'R2':
      return `at the pit floor, in ${part} of the lease`
    case 'R3':
      return `in waste placed outside the dump zones, in ${part} of the lease`
  }
}

/**
 * The Overview's first answer: how many findings, and where the worst one is. Computed from the
 * engine's findings (listed most serious first), so it changes when they do.
 */
export function answerLine(findings: readonly ComplianceFinding[], lease: Polygon): string {
  const violations = findings.filter((f) => f.status === 'violation').length
  const warnings = findings.length - violations
  const parts = [
    violations && plural(violations, 'violation'),
    warnings && plural(warnings, 'warning'),
  ]
    .filter(Boolean)
    .join(' and ')
  const first = findings[0]
  if (!first) return 'No findings. The current survey stays within the permit rules.'
  return `${parts}. The most serious is ${placeOf(first, lease)}.`
}

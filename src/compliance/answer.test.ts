import { describe, expect, it } from 'vitest'
import type { ComplianceFinding, Polygon } from '../domain/types'
import { answerLine, leaseDirection } from './answer'

const LEASE: Polygon = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 1000 },
  { x: 0, y: 1000 },
]

const finding = (
  id: string,
  ruleId: ComplianceFinding['ruleId'],
  status: ComplianceFinding['status'],
  x: number,
  y: number,
): ComplianceFinding => ({ id, ruleId, status, centroid: { x, y } }) as ComplianceFinding

describe('lease direction', () => {
  it('names the compass point of a finding from the middle of the lease', () => {
    expect(leaseDirection({ x: 950, y: 500 }, LEASE)).toBe('east')
    expect(leaseDirection({ x: 50, y: 500 }, LEASE)).toBe('west')
    expect(leaseDirection({ x: 500, y: 950 }, LEASE)).toBe('north')
    expect(leaseDirection({ x: 900, y: 100 }, LEASE)).toBe('south-east')
    expect(leaseDirection({ x: 510, y: 495 }, LEASE)).toBe('centre')
  })
})

describe('answer line', () => {
  const east = finding('R1-1', 'R1', 'violation', 950, 500)

  it('gives the counts and the place of the most serious finding', () => {
    const findings = [
      east,
      finding('R2-1', 'R2', 'violation', 400, 400),
      finding('R1-2', 'R1', 'warning', 900, 600),
      finding('R3-1', 'R3', 'warning', 100, 100),
      finding('R1-3', 'R1', 'warning', 500, 900),
    ]
    expect(answerLine(findings, LEASE)).toBe(
      '2 violations and 3 warnings. The most serious is at the east lease boundary.',
    )
  })

  it('changes when a finding changes', () => {
    const before = answerLine([east, finding('R1-2', 'R1', 'warning', 900, 600)], LEASE)
    // The worst finding moves to the west edge and the other becomes a violation.
    const after = answerLine(
      [{ ...east, centroid: { x: 40, y: 500 } }, finding('R1-2', 'R1', 'violation', 900, 600)],
      LEASE,
    )
    expect(before).toBe(
      '1 violation and 1 warning. The most serious is at the east lease boundary.',
    )
    expect(after).toBe('2 violations. The most serious is at the west lease boundary.')
  })

  it('describes each rule in its own words', () => {
    expect(answerLine([finding('R2-1', 'R2', 'violation', 100, 500)], LEASE)).toBe(
      '1 violation. The most serious is at the pit floor, in the west of the lease.',
    )
    expect(answerLine([finding('R3-1', 'R3', 'warning', 500, 950)], LEASE)).toBe(
      '1 warning. The most serious is in waste placed outside the dump zones, in the north of the lease.',
    )
    expect(answerLine([finding('R1-3', 'R1', 'warning', 500, 50)], LEASE)).toBe(
      '1 warning. The most serious is in the south safety buffer.',
    )
  })

  it('says so when nothing is flagged', () => {
    expect(answerLine([], LEASE)).toBe(
      'No findings. The current survey stays within the permit rules.',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { HOME_HREF, ROUTE_HREF, findingFromHash, plannedHash } from './route'

describe('plannedHash', () => {
  it('leaves the addresses that name a screen alone', () => {
    for (const hash of ['', ...Object.values(ROUTE_HREF)]) expect(plannedHash(hash)).toBeNull()
  })

  it('sends every other hash to the home hash', () => {
    for (const hash of [
      '#',
      '#/monitor/extra',
      '#/Monitor',
      '#/typo',
      '#findings',
      '#/../',
      '#/overview/',
    ])
      expect(plannedHash(hash)).toBe(HOME_HREF)
  })
})

describe('shared finding links', () => {
  it('reads the finding from a map hash', () => {
    expect(findingFromHash('#/monitor?finding=R1-1')).toBe('R1-1')
    expect(findingFromHash('#/monitor')).toBeNull()
    expect(findingFromHash('#/monitor?other=1')).toBeNull()
  })

  it('reads a finding after an extra literal question mark', () => {
    expect(findingFromHash('#/monitor?ref=x?finding=R1-1')).toBe('R1-1')
  })

  it('preserves normal parameters and escaped question marks', () => {
    expect(findingFromHash('#/monitor?ref=x%3Fy&finding=R1-2')).toBe('R1-2')
    expect(findingFromHash('#/monitor?ref=x%3Ffinding%3DR1-1')).toBeNull()
    expect(findingFromHash('#/monitor?finding=R1%3F1')).toBe('R1?1')
  })

  it('leaves a map hash with a query alone, and still rewrites a typo', () => {
    expect(plannedHash('#/monitor?finding=R2-1')).toBeNull()
    expect(plannedHash('#/typo?finding=R2-1')).toBe(HOME_HREF)
  })
})

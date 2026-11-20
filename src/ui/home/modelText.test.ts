import { describe, expect, it } from 'vitest'
import { modelSentence, phaseOf } from './modelText'

describe('landing model sentence', () => {
  it('names a survey only at the two ends and calls the blend an illustration', () => {
    expect(phaseOf(0)).toBe('baseline')
    expect(phaseOf(1)).toBe('current')
    for (const t of [0.05, 0.5, 0.9999]) expect(phaseOf(t)).toBe('between')
    expect(modelSentence('baseline', false, false)).toBe('Baseline survey, 14 Nov 2025.')
    expect(modelSentence('current', false, false)).toBe('Current survey, 22 Aug 2026.')
    expect(modelSentence('between', false, false)).toMatch(/illustration.*not a survey/)
  })

  it('describes the overlays, and says where they show', () => {
    expect(modelSentence('current', true, false)).toContain('rust where rock was removed')
    expect(modelSentence('current', false, true)).toContain('simulated permit findings')
    expect(modelSentence('current', true, true)).toContain('rust and blue and simulated')
    expect(modelSentence('baseline', true, false)).toContain('overlays show on the current survey')
    // One sentence each time.
    for (const s of [modelSentence('current', true, true), modelSentence('between', false, true)]) {
      expect(s.match(/\./g)).toHaveLength(1)
    }
  })
})

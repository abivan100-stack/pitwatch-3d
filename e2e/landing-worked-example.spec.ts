import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// The landing page follows one finding (R1-1) through survey, change and permit instead of
// listing three generic steps and three generic rules (#71). Every figure comes from the engine.

const READY = { timeout: 60_000 }

test('the worked example shows both survey heights and the change with their uncertainty', async ({
  page,
}) => {
  await page.goto('/')
  const heights = page.locator('.case-heights > div')
  await expect(heights).toHaveCount(3, READY)

  const rows = await heights.allInnerTexts()
  // Baseline and current each carry a height, a ± and the simulated tag; the difference is derived.
  expect(rows[0]).toMatch(/Baseline, 14 Nov 2025/)
  expect(rows[1]).toMatch(/Current, 22 Aug 2026/)
  for (const row of rows) expect(row).toMatch(/±\d+\.\d{2} m/)
  expect(rows[0]).toMatch(/\d+\.\d{2} m RL/)
  expect(rows[0]).toContain('simulated')
  expect(rows[1]).toContain('simulated')
  expect(rows[2]).toContain('derived')

  // The two lines the change has to clear are the engine's own: 0.14 m and 0.64 m.
  const step2 = page.locator('section[aria-labelledby="case-2"]')
  await expect(step2).toContainText('0.14 m (2σ)')
  await expect(step2).toContainText('0.64 m (0.5 m + 2σ)')

  // And the permit step says where the cell is, without claiming a breach.
  const step3 = page.locator('section[aria-labelledby="case-3"]')
  await expect(step3).toContainText('outside')
  await expect(page.locator('.case')).not.toContainText(/permit (was|has been) broken|breached/i)
})

test('the worked example figures match the Findings page for the same finding', async ({
  page,
}) => {
  await page.goto('/')
  const verdict = page.locator('.case-verdict')
  await expect(verdict).toContainText('R1-1', READY)
  // Each value carries a provenance tag; compare the value text without it.
  const figures = (els: Element[]) =>
    els.map((el) => {
      const dd = el.querySelector('dd')!.cloneNode(true) as HTMLElement
      const tags = [...dd.querySelectorAll('.prov')].map((t) => t.textContent)
      dd.querySelectorAll('.prov').forEach((t) => t.remove())
      return [el.querySelector('dt')!.textContent!, dd.textContent!.trim(), tags.join()]
    })
  const landing = await verdict.locator('.case-figures > div').evaluateAll(figures)
  expect(landing.map(([label]) => label)).toEqual(['Area', 'Volume', 'Max excess'])

  await page.goto('/#/findings')
  const row = page.locator('li.frow', { hasText: 'R1-1' })
  await expect(row).toBeVisible(READY)
  // The Findings row has more figures than the landing shows: compare the landing's three by label.
  const findings = await row.locator('.frow-figures > div').evaluateAll(figures)
  const byLabel = new Map(findings.map(([label, value, tag]) => [label, [value, tag]]))
  for (const [label, value, tag] of landing) {
    expect(tag).toBe('derived')
    expect([value, tag]).toEqual(byLabel.get(label))
  }
})

test('the landing sections no longer use three equal steps or rule rows', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.case-verdict')).toBeVisible(READY)

  // No three-column step list, no large-numeral rule rows, no arrow link on the sections.
  await expect(page.locator('.step-list, .step, .rule-row')).toHaveCount(0)
  await expect(page.locator('#how .link-arrow, #checks .link-arrow')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show on the model' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Show on the model' })).toHaveCount(0)

  // The sections that stay still say the data is simulated.
  await expect(page.locator('.sim-note')).toHaveText('Simulated data')
  await expect(page.locator('#how')).toContainText('simulated')

  // The three rules are a one-line-each ledger that still reports the engine's counts.
  const ledger = page.locator('ol.ledger')
  await expect(ledger.locator('li')).toHaveCount(3)
  await expect(ledger).toContainText('1 violation, 2 warnings')
})

for (const width of [1440, 390]) {
  test(`the worked example keeps text at 13 px or more and does not overflow at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.locator('.case-verdict')).toBeVisible(READY)

    const small = await page.evaluate(() =>
      [...document.querySelectorAll('#how *, #checks *')]
        .filter(
          (el) =>
            el.children.length === 0 &&
            (el.textContent ?? '').trim() !== '' &&
            parseFloat(getComputedStyle(el).fontSize) < 13,
        )
        .map((el) => `${el.tagName}: ${el.textContent}`),
    )
    expect(small).toEqual([])

    const overflow = await page.evaluate(() => {
      const landing = document.querySelector('.landing')!
      return landing.scrollWidth - landing.clientWidth
    })
    expect(overflow).toBe(0)
  })
}

// a11y.spec.ts scans the landing page before the engine reports; the worked example only exists
// afterwards, so it is scanned here once it is on the page. No violation of any impact.
test.describe('accessibility with the worked example on the page', () => {
  test.use({ reducedMotion: 'reduce' })
  for (const width of [1440, 390]) {
    test(`no WCAG A/AA violation at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await expect(page.locator('.case-verdict')).toBeVisible(READY)
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(
        violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      ).toEqual([])
    })
  }
})

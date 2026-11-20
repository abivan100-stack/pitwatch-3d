import { expect, test, type Page } from '@playwright/test'

// The map panel's Findings tab has one compact layout and no density control (issue #107).

test.use({ reducedMotion: 'reduce' })

const panel = (page: Page) => page.locator('#details-tabpanel')

for (const height of [900, 800]) {
  test(`five compact rows fit the panel at 1440 x ${height}, with no toggle`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1440, height })
    await page.goto('/#/monitor')
    const rows = panel(page).locator('li.finding')
    await expect(rows).toHaveCount(5, { timeout: 60_000 })

    await expect(page.getByRole('button', { name: /compact|density|comfortable/i })).toHaveCount(0)
    await expect(panel(page).locator('details.threshold-more')).not.toHaveAttribute('open', '')
    await expect(panel(page).getByText(/A cell counts as changed/)).toBeHidden()

    // Status and severity in text, the three figures in the key's order, the map button.
    await expect(panel(page).getByText('Area · volume · max excess')).toBeVisible()
    for (const row of await rows.all()) {
      await expect(row).toContainText(/(Violation|Warning) · (critical|high|medium|low)/)
      await expect(row).toContainText(/[\d,]+ m² · .*[\d,]+ m³ · .*[\d.]+ m max/)
      await expect(row.getByRole('button', { name: 'Show on map' })).toBeVisible()
    }

    const boxes = await page.evaluate(() => {
      const box = document.querySelector('#details-tabpanel')!.getBoundingClientRect()
      const rows = [...document.querySelectorAll('#details-tabpanel li.finding')]
      return {
        top: box.top,
        bottom: Math.min(box.bottom, window.innerHeight),
        rows: rows.map((li) => {
          const r = li.getBoundingClientRect()
          return { top: r.top, bottom: r.bottom, height: r.height }
        }),
      }
    })
    console.log(`1440 x ${height}: row heights ${boxes.rows.map((r) => r.height).join(', ')} px`)
    for (const r of boxes.rows) {
      expect(r.height).toBeLessThanOrEqual(76)
      expect(r.top).toBeGreaterThanOrEqual(boxes.top)
      expect(r.bottom).toBeLessThanOrEqual(boxes.bottom)
    }
  })
}

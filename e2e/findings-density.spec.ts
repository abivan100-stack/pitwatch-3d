import { expect, test, type Page } from '@playwright/test'

// The map panel's Findings tab has a Compact toggle (comfortable by default, session only) and the
// threshold note behind one closed disclosure. The Findings page has neither.

test.use({ reducedMotion: 'reduce' })

const panel = (page: Page) => page.locator('#details-tabpanel')
const toggle = (page: Page) => panel(page).getByRole('button', { name: 'Compact' })

async function openMap(page: Page, width: number, height: number) {
  test.setTimeout(90_000)
  await page.setViewportSize({ width, height })
  await page.goto('/#/monitor')
  await expect(page.locator('li.finding')).toHaveCount(5, { timeout: 60_000 })
}

/** Findings whose whole card sits inside the panel's visible area. */
const fullyVisible = (page: Page) =>
  page.evaluate(() => {
    const box = document.querySelector('#details-tabpanel')!.getBoundingClientRect()
    const bottom = Math.min(box.bottom, window.innerHeight)
    return [...document.querySelectorAll('#details-tabpanel li.finding')].filter((li) => {
      const r = li.getBoundingClientRect()
      return r.top >= box.top && r.bottom <= bottom
    }).length
  })

for (const height of [900, 700]) {
  test(`compact shows more of the list than comfortable at 1440 x ${height}`, async ({ page }) => {
    await openMap(page, 1440, height)
    await checkDensity(page, height)
  })
}

async function checkDensity(page: Page, height: number) {
  const btn = toggle(page)
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  const comfortable = await fullyVisible(page)
  const comfortableH = (await page.locator('.finding-list').boundingBox())!.height

  await btn.focus()
  await page.keyboard.press('Enter')
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('li.finding[data-density=compact]')).toHaveCount(5)
  await page.waitForTimeout(300)
  const compact = await fullyVisible(page)
  const compactH = (await page.locator('.finding-list').boundingBox())!.height
  console.log(
    `height ${height}: visible ${comfortable} -> ${compact}; list ${comfortableH} -> ${compactH} px`,
  )
  expect(compactH).toBeLessThan(comfortableH * 0.9)
  expect(compact).toBeGreaterThanOrEqual(comfortable)
  // Where the 900 px panel already holds all five, the shorter window is the one that gains.
  if (height < 800) expect(compact).toBeGreaterThan(comfortable)

  // Status and severity stay in text; the other controls are still there.
  const first = page.locator('li.finding').first()
  await expect(first).toContainText(/(Violation|Warning), \w+ severity/)
  await expect(first.getByRole('button', { name: 'Show on map' })).toBeVisible()
  await expect(first).toContainText('Why it was flagged')

  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('li.finding[data-density=compact]')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(await fullyVisible(page)).toBe(comfortable)
}

test('the threshold note is closed on arrival and opens with its wording', async ({ page }) => {
  await openMap(page, 1440, 900)
  const more = panel(page).locator('details.threshold-more')
  await expect(more).not.toHaveAttribute('open', '')
  const text = panel(page).getByText(
    /A cell counts as changed when it moved more than 0\.5 m plus 2σ/,
  )
  await expect(text).toBeHidden()
  await more.getByText('How a change is counted').click()
  await expect(text).toBeVisible()
  await expect(text).toContainText(/σ = 0\.\d\d m for the two surveys combined/)
})

test('the phone drawer has the toggle and does not overflow at 390 px', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/monitor')
  await page.locator('button[aria-controls="side-panel"]').click()
  const drawer = page.getByRole('complementary', { name: 'Details' })
  await expect(drawer.locator('li.finding')).toHaveCount(5, { timeout: 60_000 })
  const btn = drawer.getByRole('button', { name: 'Compact' })
  await btn.click()
  await expect(btn).toHaveAttribute('aria-pressed', 'true')
  await drawer.getByText('How a change is counted').click()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const d = await drawer.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(d).toBeLessThanOrEqual(0)
})

test('the Findings page has no density toggle or threshold disclosure', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/#/findings')
  await expect(page.locator('li.frow')).toHaveCount(5, { timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Compact' })).toHaveCount(0)
  await expect(page.locator('details.threshold-more')).toHaveCount(0)
  await expect(page.getByText(/A cell counts as changed when it moved more than/)).toBeVisible()
})

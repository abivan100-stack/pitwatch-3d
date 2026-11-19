import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.use({ reducedMotion: 'reduce' })

const num = (s: string) => Number(s.replace(/[^\d.-]/g, ''))

async function open(page: Page) {
  await page.goto('/#/findings')
  await expect(page.locator('li.frow')).toHaveCount(5, { timeout: 60_000 })
}

test('Details is closed by default, opens with the keyboard and lists the R1-1 critical measures', async ({
  page,
}) => {
  await open(page)
  const row = page.locator('li.frow', { hasText: 'R1-1' })
  const button = row.getByRole('button', { name: 'Details' })
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  // Closed: the plan is not reachable and the row adds one focus stop (the button) for the body.
  await expect(row.locator('svg[role=img]')).toBeHidden()

  await button.focus()
  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'true')

  const why = row.getByRole('region', { name: /Why R1-1 has this rating/ })
  await expect(why).toContainText('Area')
  await expect(why).toContainText('(critical from 5,000 m²)')
  await expect(why).toContainText('(critical from 25,000 m³)')
  await expect(why).toContainText('(critical from 10 m)')
  // The measured values are the row's own figures (the value, without its provenance tag).
  const area = await row
    .locator('.frow-figures div', { hasText: 'Area' })
    .locator('dd')
    .evaluate((dd) => dd.firstChild!.textContent!.trim())
  await expect(why).toContainText(`Area ${area}`)

  await expect(row.getByRole('region', { name: /Measurements for R1-1/ })).toContainText('±')
  await expect(row.getByRole('region', { name: /Where R1-1 is/ })).toContainText(
    'Distance to lease boundary',
  )
  await expect(row.locator('svg[role=img]')).toBeVisible()
  await expect(row.locator('svg[role=img]')).toHaveAttribute('aria-label', /cells centred at/)

  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'false')
})

test('the summary strip totals follow the filters and match the rows and the CSV', async ({
  page,
}) => {
  await open(page)
  const strip = page.getByRole('region', { name: /Totals for the shown findings/ })
  const value = async (label: string) =>
    num(await strip.locator('div', { hasText: label }).locator('dd').first().innerText())

  const rowSum = async (col: string) => {
    const cells = page.locator(`li.frow .frow-figures div:has(dt:text-is("${col}")) dd`)
    let total = 0
    for (const t of await cells.allInnerTexts()) total += num(t)
    return total
  }

  // Rows are rounded for display, so compare within one unit per row.
  expect(Math.abs((await value('Area flagged')) - (await rowSum('Area')))).toBeLessThanOrEqual(5)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ])
  const lines = (await readFile((await download.path())!, 'utf8')).trim().split(/\r?\n/)
  const head = lines[0]!.split(',')
  const col = (name: string) => head.indexOf(name)
  const rows = lines.slice(1).map((l) => l.split(','))
  const areaCsv = rows.reduce((a, r) => a + num(r[col('area_m2')]!), 0)
  const fill = rows
    .filter((r) => r[col('rule')] === 'R3')
    .reduce((a, r) => a + num(r[col('volume_m3')]!), 0)
  const cut = rows
    .filter((r) => r[col('rule')] !== 'R3')
    .reduce((a, r) => a + num(r[col('volume_m3')]!), 0)
  expect(Math.abs((await value('Area flagged')) - areaCsv)).toBeLessThanOrEqual(3)
  expect(Math.abs((await value('Fill volume')) - fill)).toBeLessThanOrEqual(3)
  expect(Math.abs((await value('Cut and below-floor volume')) - cut)).toBeLessThanOrEqual(3)

  // Filtering to R3 leaves only the fill volume.
  await page
    .getByRole('group', { name: 'Show findings by rule' })
    .getByRole('button', { name: 'R3', exact: true })
    .click()
  await expect(page.locator('li.frow')).toHaveCount(1)
  expect(await value('Cut and below-floor volume')).toBe(0)
  expect(await value('Fill volume')).toBeGreaterThan(0)
})

for (const width of [1440, 390]) {
  test(`Details open: no overflow and no serious axe violation at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await open(page)
    for (const b of await page.getByRole('button', { name: 'Details' }).all()) await b.click()
    await expect(page.locator('svg[role=img]')).toHaveCount(5)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(
      violations
        .filter((v) => v.impact === 'critical' || v.impact === 'serious')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([])
  })
}

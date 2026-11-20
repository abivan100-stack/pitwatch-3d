import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

const ANSWER = /^2 violations and 3 warnings\. The most serious is at the east lease boundary\.$/

async function openOverview(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.goto('/#/overview')
  await expect(page.locator('#answer')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('li.attention')).toHaveCount(3)
  await expect(page.locator('svg.site-plan .plan-finding-area')).toHaveCount(5)
}

test('at 1440 x 900 the answer, the plan with its key and the first finding are on screen', async ({
  page,
}) => {
  await openOverview(page, 1440, 900)
  const inView = async (selector: string) => {
    const box = await page.locator(selector).first().boundingBox()
    expect(box, selector).not.toBeNull()
    expect(box!.y, `${selector} starts inside the screen`).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height, `${selector} ends inside the screen`).toBeLessThanOrEqual(900)
  }
  await inView('#answer')
  await inView('svg.site-plan')
  await inView('.plan-key')
  await inView('li.attention')
})

test('the answer line is computed from the findings and names the place', async ({ page }) => {
  await openOverview(page, 1440, 900)
  await expect(page.locator('#answer')).toHaveText(ANSWER)
})

test('the violation and warning counts appear in the header chip and the answer line only', async ({
  page,
}) => {
  await openOverview(page, 1440, 900)
  const main = await page.locator('main').innerText()
  expect(main.match(/\b\d+ violations?\b/g)).toHaveLength(1)
  expect(main.match(/\b\d+ warnings?\b/g)).toHaveLength(1)
  expect(await page.locator('#answer').innerText()).toMatch(/\d+ violations and \d+ warnings/)
  await expect(page.locator('.status-light')).toHaveText('2 violations, 3 warnings')
  // The three figures keep what the answer line does not carry.
  const labels = await page.locator('.figures dt').allInnerTexts()
  expect(labels.map((l) => l.replace(/\s+derived$/i, '').trim())).toEqual([
    'Removed outside the lease',
    'Flagged area',
    'Between the surveys',
  ])
})

test('the removed-volume figure and the R1-1 explanation quote the same number', async ({
  page,
}) => {
  await openOverview(page, 1440, 900)
  const tile = await page
    .locator('.figure')
    .filter({ hasText: 'Removed outside the lease' })
    .locator('dd')
    .first()
    .innerText()
  const volume = tile.match(/^([\d,]+) m³$/)?.[1]
  expect(volume, `figure text "${tile}"`).toBeTruthy()
  const text = await page
    .locator('li.attention')
    .filter({ hasText: 'R1-1' })
    .locator('.attention-text')
    .textContent()
  expect(text).toContain(`${volume} m³ removed.`)
  expect(text).not.toMatch(/About/)
  // Depths quote their band the same way in the two violations.
  const depths = await page.locator('.attention-text').allTextContents()
  expect(depths[0]).toMatch(/\d+\.\d m ± 0\.14 m \(2σ\)/)
  expect(depths[1]).toMatch(/\d+\.\d m ± 0\.10 m \(2σ\)/)
})

test('every colour and shape on the plan is in the key, in the same style', async ({ page }) => {
  await openOverview(page, 1440, 900)
  const result = await page.evaluate(() => {
    const plan = document.querySelector('svg.site-plan')!
    const key = (k: string) => document.querySelector(`.plan-key [data-key="${k}"]`)!
    const style = (el: Element) => getComputedStyle(el)
    const swatch = (k: string) => style(key(k).querySelector('.plan-swatch')!)
    const first = (sel: string) => style(plan.querySelector(sel)!)
    const pairs: [string, string, string][] = [
      ['cut', first('.plan-cut').fill, swatch('cut').backgroundColor],
      ['fill', first('.plan-fill').fill, swatch('fill').backgroundColor],
      ['lease', first('.plan-lease').stroke, swatch('lease').borderTopColor],
      ['buffer', first('.plan-buffer').stroke, swatch('buffer').borderTopColor],
      ['pit', first('.plan-pit').stroke, swatch('pit').borderTopColor],
      ['dump', first('.plan-dump').stroke, swatch('dump').borderTopColor],
      ['contour', first('.plan-contour').stroke, swatch('contour').borderTopColor],
    ]
    for (const tone of ['warning', 'violation', 'critical']) {
      const area = plan.querySelector(`.plan-pin.tone-${tone} .plan-finding-area`)
      if (area) pairs.push([tone, style(area).stroke, style(key(tone).querySelector('svg')!).color])
    }
    // Dash styles agree with the swatch borders.
    const dashes: [string, boolean, string][] = [
      ['buffer', first('.plan-buffer').strokeDasharray !== 'none', swatch('buffer').borderTopStyle],
      ['pit', first('.plan-pit').strokeDasharray !== 'none', swatch('pit').borderTopStyle],
      ['dump', first('.plan-dump').strokeDasharray !== 'none', swatch('dump').borderTopStyle],
      ['lease', first('.plan-lease').strokeDasharray !== 'none', swatch('lease').borderTopStyle],
    ]
    // Every class the plan paints with is either keyed or label/badge chrome.
    const keyed = new Set([
      'plan-cut',
      'plan-fill',
      'plan-lease',
      'plan-buffer',
      'plan-pit',
      'plan-dump',
      'plan-contour',
      'plan-finding-area',
    ])
    const chrome = new Set([
      'plan-ground',
      'plan-line',
      'plan-change',
      'plan-zone-label',
      'plan-pit-label',
      'plan-dump-label',
      'plan-lease-label',
      'plan-zone-leader',
      'plan-pit-leader',
      'plan-dump-leader',
      'plan-leader',
      'plan-finding-origin',
      'plan-pin',
      'plan-pin-hit',
      'plan-pin-disc',
      'plan-pin-glyph',
      'plan-pin-ring',
      'plan-pin-label-bg',
      'plan-pin-label',
    ])
    const unknown = new Set<string>()
    for (const el of plan.querySelectorAll('[class]')) {
      for (const c of el.getAttribute('class')!.split(/\s+/)) {
        if (!c.startsWith('tone-') && !keyed.has(c) && !chrome.has(c)) unknown.add(c)
      }
    }
    const keyShapes = ['warning', 'violation', 'critical'].map((t) => !!key(t).querySelector('svg'))
    return { pairs, dashes, unknown: [...unknown], keyShapes }
  })
  for (const [name, plan, swatch] of result.pairs) {
    expect(swatch, `key swatch for ${name}`).toBe(plan)
  }
  for (const [name, planDashed, swatchStyle] of result.dashes) {
    expect(swatchStyle !== 'solid', `${name} dash style`).toBe(planDashed)
  }
  expect(result.unknown, 'plan classes with no place in the key').toEqual([])
  expect(result.keyShapes).toEqual([true, true, true])
  // The three shapes on the plan are the three in the key: a triangle, an octagon, a diamond.
  await expect(page.locator('.plan-key [data-key="warning"] svg')).toBeVisible()
})

test('the plan draws at most four pale index contours under the change fills', async ({ page }) => {
  await openOverview(page, 1440, 900)
  const plan = page.locator('svg.site-plan')
  const count = await plan.locator('.plan-contour').count()
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThanOrEqual(4)
  const tones = await plan.evaluate((svg) => {
    const contour = getComputedStyle(svg.querySelector('.plan-contour')!)
    const cut = getComputedStyle(svg.querySelector('.plan-cut')!)
    const order = svg
      .querySelector('.plan-contour')!
      .compareDocumentPosition(svg.querySelector('.plan-cut')!)
    return {
      contour: Number(contour.strokeOpacity),
      fill: Number(cut.fillOpacity),
      // 4 = the change fill follows the contour in the document, so it paints over it.
      fillAfter: (order & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    }
  })
  expect(tones.contour).toBeLessThan(tones.fill)
  expect(tones.fillAfter).toBe(true)
})

test('each finding outline is a keyboard button; selecting it lights the list row and plan', async ({
  page,
}) => {
  await openOverview(page, 1440, 900)
  const plan = page.getByRole('group', { name: /Plan of the mine from above/ })
  const outline = plan.getByRole('button', {
    name: /^R1-1, Lease boundary and buffer, violation, critical severity/,
  })
  await expect(outline).toHaveCount(1)
  // The outline is focusable, and focusing it lights the matching list row.
  await outline.focus()
  await expect(outline).toBeFocused()
  await expect(page.locator('li.attention').filter({ hasText: 'R1-1' })).toHaveAttribute(
    'data-active',
    'true',
  )

  // The list's own button highlights the same finding on the plan without leaving the page.
  const row = page.locator('li.attention').filter({ hasText: 'R1-1' })
  await row.getByRole('button', { name: 'Highlight on plan' }).click()
  await expect(page).toHaveURL(/#\/overview$/)
  await expect(row).toHaveAttribute('data-selected', 'true')
  await expect(outline).toHaveAttribute('aria-pressed', 'true')

  // Hovering another row highlights its outline and badge.
  await page.locator('li.attention').filter({ hasText: 'R2-1' }).hover()
  await expect(plan.locator('.plan-pin[data-finding="R2-1"]')).toHaveAttribute(
    'data-active',
    'true',
  )

  // And Show on map opens the same finding on the map.
  await row.getByRole('button', { name: 'Show on map' }).click()
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-1$/)
  await expect(page.locator('#details-tabpanel li.finding[data-selected]')).toContainText('R1-1', {
    timeout: 60_000,
  })
})

test('the scale bar and north arrow sit in the footer rail, below the drawing, at every width', async ({
  page,
}) => {
  for (const [width, height] of [
    [390, 844],
    [800, 900],
    [1100, 900],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await openOverview(page, width, height)
    const rects = await page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().toJSON()
      return {
        svg: r('svg.site-plan'),
        key: r('.plan-key'),
        footer: r('.plan-footer'),
        north: r('.plan-footer .plan-north-block'),
        scale: r('.plan-footer .plan-scale-block'),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
      }
    })
    expect(rects.overflow, `overflow at ${width}px`).toBe(false)
    expect(rects.key.top, `key under the drawing at ${width}px`).toBeGreaterThanOrEqual(
      rects.svg.bottom - 0.5,
    )
    expect(rects.footer.top, `footer under the key at ${width}px`).toBeGreaterThanOrEqual(
      rects.key.bottom - 0.5,
    )
    for (const part of [rects.north, rects.scale]) {
      expect(part.top, `instrument below the drawing at ${width}px`).toBeGreaterThanOrEqual(
        rects.svg.bottom,
      )
      expect(part.right).toBeLessThanOrEqual(rects.footer.right + 0.5)
    }
    if (width === 390) expect(rects.svg.width).toBeGreaterThanOrEqual(340)
  }
})

test('the details fold is closed until opened, by keyboard, and holds three tight groups', async ({
  page,
}) => {
  await openOverview(page, 1440, 900)
  const details = page.locator('details.details-fold')
  await expect(details).not.toHaveAttribute('open', '')
  await details.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(details).toHaveAttribute('open', '')
  await expect(details.locator('h3')).toHaveText(['Surveys', 'Permit', 'Surface'])
  await expect(details.locator('dt')).toHaveText([
    'Baseline',
    'Current',
    'Method',
    'Grid',
    'Grid origin',
    'Operator',
    'Lease area',
    'Safety buffer',
    'Approved floor',
    'Lowest point',
    'Highest point',
  ])

  // The zones go by their display names, and the interval is the headline figure's alone.
  const main = await page.locator('main').innerText()
  expect(main).toContain('Main pit')
  expect(main).toContain('South pit')
  expect(main).not.toMatch(/pit-main|pit-south/)
  expect(main.match(/281 days/g)).toHaveLength(1)

  for (const width of [1440, 1100]) {
    await page.setViewportSize({ width, height: 900 })
    const m = await details.evaluate((el) => {
      const px = (n: Element) => parseFloat(getComputedStyle(n).fontSize)
      return {
        columns: new Set(
          [...el.querySelectorAll('.fact-group')].map((g) => g.getBoundingClientRect().left),
        ).size,
        rows: [...el.querySelectorAll('.fact')].map((row) => {
          const values = [...row.querySelectorAll('.fact-value')]
          return {
            label: row.querySelector('dt')!.textContent!,
            // One line per value: the approved floor has one line per pit.
            lineHeight: row.getBoundingClientRect().height / values.length,
            tags: row.querySelectorAll('.prov').length - values.length,
            gaps: values.map(
              (v) =>
                v.nextElementSibling!.getBoundingClientRect().left -
                v.getBoundingClientRect().right,
            ),
            tagged: values.every((v) => v.nextElementSibling!.classList.contains('prov')),
            mono: values.some((v) => /JetBrains Mono/.test(getComputedStyle(v).fontFamily)),
            tabular: values.every((v) =>
              getComputedStyle(v).fontVariantNumeric.includes('tabular-nums'),
            ),
          }
        }),
        smallest: Math.min(...[...el.querySelectorAll('summary, h3, dt, dd, dd *, p')].map(px)),
      }
    })
    expect(m.columns, `columns at ${width}px`).toBe(3)
    expect(m.smallest, `smallest text at ${width}px`).toBeGreaterThanOrEqual(13)
    for (const row of m.rows) {
      const at = `${row.label} at ${width}px`
      expect(row.lineHeight, `${at}: one line per value`).toBeLessThanOrEqual(28)
      expect(row.tags, `${at}: one tag per value`).toBe(0)
      expect(row.tagged, `${at}: the tag follows its value`).toBe(true)
      for (const gap of row.gaps) {
        expect(gap, `${at}: value to tag`).toBeGreaterThanOrEqual(0)
        expect(gap, `${at}: value to tag`).toBeLessThanOrEqual(12)
      }
      expect(row.tabular, `${at}: tabular figures`).toBe(true)
      // Dates and coordinates are monospace; nothing else is.
      expect(row.mono, `${at}: monospace`).toBe(
        ['Baseline', 'Current', 'Grid origin'].includes(row.label),
      )
    }
  }

  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 900 })
    const m = await details.evaluate((el) => ({
      columns: new Set(
        [...el.querySelectorAll('.fact-group')].map((g) => g.getBoundingClientRect().left),
      ).size,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    }))
    expect(m.columns, `columns at ${width}px`).toBe(1)
    expect(m.overflow, `overflow at ${width}px`).toBe(false)
  }
  await expect(page.getByText('Result by permit rule')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Explore in 3D' })).toBeVisible()
})

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`the overview has no critical or serious accessibility violation at ${width}px`, async ({
    page,
  }) => {
    await openOverview(page, width, height)
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

import { expect, test, type Page } from '@playwright/test'

// The Map card used to list all eight switches and a permanent hint. It now shows one primary per
// group (Terrain, Findings); the rest sit behind a counted button that opens with a 200 ms height
// transition. The phone drawer carries the same grouping from the same component.

async function openMap(page: Page, width: number, height: number) {
  test.setTimeout(90_000)
  await page.setViewportSize({ width, height })
  await page.goto('/#/monitor')
  await expect(page.getByRole('group', { name: 'Camera view' })).toBeVisible({ timeout: 60_000 })
  return page.getByRole('navigation', { name: 'Map', exact: true })
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('two switch rows at rest, with counts that include hidden switches that are on', async ({
    page,
  }) => {
    const card = await openMap(page, 1440, 900)
    await expect(card.getByRole('switch')).toHaveCount(2)
    await expect(card.getByRole('switch', { name: 'Terrain' })).toBeVisible()
    await expect(card.getByRole('switch', { name: 'Findings' })).toBeVisible()
    // Hidden switches leave the accessibility tree, so none of the other six is reachable.
    await expect(card.getByRole('switch', { name: 'Contours' })).toHaveCount(0)

    // The lease boundary is on by default, so only the permit group reports one on.
    const layers = card.getByRole('button', { name: '2 more', exact: true })
    const permit = card.getByRole('button', { name: '4 more · 1 on', exact: true })
    await expect(layers).toHaveAttribute('aria-expanded', 'false')
    await expect(permit).toHaveAttribute('aria-expanded', 'false')

    await layers.click()
    await card.getByRole('switch', { name: 'Contours' }).click()
    await expect(card.getByRole('button', { name: '2 more · 1 on', exact: true })).toBeVisible()
    await permit.click()
    await card.getByRole('switch', { name: 'Change since baseline' }).click()
    await expect(card.getByRole('button', { name: '4 more · 2 on', exact: true })).toBeVisible()
    await card.getByRole('switch', { name: 'Lease boundary' }).click()
    await card.getByRole('switch', { name: 'Change since baseline' }).click()
    await expect(card.getByRole('button', { name: '4 more', exact: true })).toBeVisible()
    await expect(card.getByRole('switch')).toHaveCount(8)
  })

  test('the dropdowns and the hint open and close from the keyboard and keep focus', async ({
    page,
  }) => {
    const card = await openMap(page, 1440, 900)
    for (const name of [/^2 more/, /^4 more/, 'How to move the view']) {
      const button = card.getByRole('button', { name })
      const body = page.locator(`#${await button.getAttribute('aria-controls')}`)
      await button.focus()
      await page.keyboard.press('Enter')
      await expect(button).toHaveAttribute('aria-expanded', 'true')
      await expect(button).toBeFocused()
      await expect(body).toBeVisible()
      await page.keyboard.press('Space')
      await expect(button).toHaveAttribute('aria-expanded', 'false')
      await expect(button).toBeFocused()
      await expect(body).toBeHidden()
    }
    // Closed, the hidden switches are not Tab stops: Tab from the first dropdown button lands on
    // the Findings switch, not on Elevation tint.
    await card.getByRole('button', { name: /^2 more/ }).focus()
    await page.keyboard.press('Tab')
    await expect(card.getByRole('switch', { name: 'Findings' })).toBeFocused()
  })

  test('no animation under reduced motion', async ({ page }) => {
    const card = await openMap(page, 1440, 900)
    const button = card.getByRole('button', { name: /^2 more/ })
    const body = page.locator(`#${await button.getAttribute('aria-controls')}`)
    expect(await body.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
    await button.click()
    // At full height on the very next frame.
    const h = await body.evaluate(
      (el) => new Promise<number>((r) => requestAnimationFrame(() => r(el.clientHeight))),
    )
    expect(h).toBeGreaterThan(40)
  })

  test('the phone drawer has the same grouping', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#/monitor')
    await page.getByRole('group', { name: 'Camera view' }).waitFor({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Details' }).click()
    const drawer = page.getByRole('complementary', { name: 'Details' })
    await drawer.locator('summary', { hasText: 'Map layers and vertical scale' }).click()
    await expect(drawer.getByRole('switch')).toHaveCount(2)
    await expect(drawer.getByRole('button', { name: '2 more', exact: true })).toBeVisible()
    await expect(drawer.getByRole('button', { name: '4 more · 1 on', exact: true })).toBeVisible()
  })

  for (const [width, height] of [
    [390, 844],
    [800, 900],
  ]) {
    test(`no horizontal overflow at ${width} px with every dropdown open`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width, height })
      await page.goto('/#/monitor')
      await page.getByRole('group', { name: 'Camera view' }).waitFor({ timeout: 60_000 })
      if (width < 768) {
        await page.getByRole('button', { name: 'Details' }).click()
        await page.locator('summary', { hasText: 'Map layers and vertical scale' }).click()
      } else {
        await page.getByRole('button', { name: 'Map panel' }).click()
      }
      for (const b of await page.getByRole('button', { name: /\d+ more|How to move/ }).all()) {
        await b.click()
      }
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(over).toBeLessThanOrEqual(0)
    })
  }
})

test('with full motion the dropdown uses a 200 ms ease-out height transition', async ({ page }) => {
  const card = await openMap(page, 1440, 900)
  const button = card.getByRole('button', { name: /^2 more/ })
  const body = page.locator(`#${await button.getAttribute('aria-controls')}`)
  const style = await body.evaluate((el) => {
    const c = getComputedStyle(el)
    return [c.transitionProperty, c.transitionDuration, c.transitionTimingFunction]
  })
  expect(style[0]).toContain('grid-template-rows')
  expect(style[1]).toContain('0.2s')
  expect(style[2]).toContain('ease-out')
})

test('card height at rest, 1440 x 900', async ({ page }) => {
  const card = await openMap(page, 1440, 900)
  const box = (await card.boundingBox())!
  console.log(`MAP_CARD_HEIGHT ${box.height}`)
  expect(box.height).toBeLessThan(330)
})

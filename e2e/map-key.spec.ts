import { expect, test, type Locator, type Page } from '@playwright/test'

// The colour key used to sit at the bottom of the Map card, below the switches and the slider, so
// nobody reached it. It now sits on the stage above the timeline: open on arrival where there is
// room, a single "Key" button otherwise.

test.use({ reducedMotion: 'reduce' })

const SIZES = [
  { width: 390, height: 844 },
  { width: 800, height: 900 },
  { width: 1100, height: 700 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]

async function openMap(page: Page, width: number, height: number) {
  test.setTimeout(90_000)
  await page.setViewportSize({ width, height })
  await page.goto('/#/monitor')
  await expect(page.getByRole('group', { name: 'Camera view' })).toBeVisible({ timeout: 60_000 })
  return page.getByRole('region', { name: 'Map key' })
}

const toggle = (key: Locator) => key.getByRole('button', { name: /^Key/ })

test('the key is open on arrival at 1440 x 900 and lists the active overlays', async ({ page }) => {
  const key = await openMap(page, 1440, 900)
  await expect(toggle(key)).toHaveAttribute('aria-expanded', 'true')
  // Default layers: Terrain and Findings on, so the aerial surfaces and the three finding shapes.
  for (const label of ['Scrub', 'Haul road', 'Warning', 'Violation', 'Critical']) {
    await expect(key.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(key.getByText('Simulated aerial image')).toBeVisible()
  expect((await key.locator('.card').boundingBox())!.width).toBeLessThanOrEqual(260)

  // Each row is one line.
  for (const row of await key.locator('li').all()) {
    expect((await row.boundingBox())!.height, await row.innerText()).toBeLessThanOrEqual(20)
  }

  // Nothing in the key is smaller than 12 px.
  const smallest = await key.evaluate((el) =>
    Math.min(
      ...[...el.querySelectorAll('*')]
        .filter((n) => [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent?.trim()))
        .map((n) => parseFloat(getComputedStyle(n).fontSize)),
    ),
  )
  expect(smallest).toBeGreaterThanOrEqual(12)
})

test('the key rows follow the active layers', async ({ page }) => {
  const key = await openMap(page, 1440, 900)
  const map = page.getByRole('navigation', { name: 'Map', exact: true })
  await expect(key.getByText('Violation', { exact: true })).toBeVisible()
  await map.getByRole('switch', { name: 'Findings' }).click()
  await expect(key.getByText('Violation', { exact: true })).toHaveCount(0)
  await expect(key.getByText('Warning', { exact: true })).toHaveCount(0)

  await map.getByRole('switch', { name: 'Lease boundary' }).click()
  await expect(key.getByText('Lease boundary')).toHaveCount(0)
  await map.getByRole('switch', { name: 'Lease boundary' }).click()
  await expect(key.getByText('Lease boundary')).toBeVisible()

  await map.getByRole('switch', { name: 'Change since baseline' }).click()
  await expect(key.getByText('Excavated', { exact: true })).toBeVisible()
  await expect(key.getByText(/Changes under 0\.\d\d m are not shown \(noise\)/)).toBeVisible()
})

for (const size of [
  { width: 1100, height: 700 },
  { width: 390, height: 844 },
]) {
  test(`the key is a collapsed button at ${size.width} x ${size.height} and toggles by keyboard`, async ({
    page,
  }) => {
    const key = await openMap(page, size.width, size.height)
    const button = toggle(key)
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    // The count of entries is on the button; the content is out of reach until it opens.
    await expect(button).toHaveText(/Key\s*\d+/)
    await expect(key.getByText('Violation', { exact: true })).toBeHidden()

    await button.focus()
    await page.keyboard.press('Enter')
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(key.getByText('Violation', { exact: true })).toBeVisible()
    await page.keyboard.press('Space')
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await expect(button).toBeFocused()

    await button.click()
    await expect(key.getByText('Violation', { exact: true })).toBeVisible()
  })
}

test('folding the Map card with [ leaves the key where it is', async ({ page }) => {
  const key = await openMap(page, 1440, 900)
  await page.keyboard.press('[')
  await expect(page.getByRole('navigation', { name: 'Map', exact: true })).toBeHidden({
    timeout: 20_000,
  })
  await expect(toggle(key)).toHaveAttribute('aria-expanded', 'true')
  await expect(key.getByText('Violation', { exact: true })).toBeVisible()
})

for (const { width, height } of SIZES) {
  test(`the key overlaps no other map control at ${width} px`, async ({ page }) => {
    const key = await openMap(page, width, height)
    const others = [
      page.getByRole('region', { name: 'Survey timeline' }),
      page.locator('.stage .map-chip[aria-hidden="true"]'),
      page.getByRole('group', { name: 'Camera view' }),
      page.getByRole('button', { name: /^Compass/ }),
      page.getByRole('group', { name: 'Click tool' }),
      // The tool buttons and their status chip (it holds the measurement and Clear).
      page.getByRole('group', { name: 'Click tool' }).locator('xpath=..'),
      page.getByRole('navigation', { name: 'Map', exact: true }),
    ]
    const check = async (state: string) => {
      // The key's own footprint: the button, plus the card while it is open.
      const mine = [toggle(key), key.locator('.card')]
      for (const m of mine) {
        if (!(await m.isVisible())) continue
        const a = (await m.boundingBox())!
        for (const o of others) {
          if (!(await o.isVisible())) continue
          const b = (await o.boundingBox())!
          const apart =
            a.x + a.width <= b.x + 0.5 ||
            b.x + b.width <= a.x + 0.5 ||
            a.y + a.height <= b.y + 0.5 ||
            b.y + b.height <= a.y + 0.5
          expect(
            apart,
            `${state} key vs ${await o.evaluate((e) => e.getAttribute('aria-label') ?? e.className)}`,
          ).toBe(true)
        }
      }
    }
    await check('initial')
    await toggle(key).click()
    // Reduced motion switches at once, so the card is either there or gone.
    const open = (await toggle(key).getAttribute('aria-expanded')) === 'true'
    await expect(key.locator('.card')).toBeVisible({ visible: open })
    await check('toggled')
  })
}

// With every layer on, the key is at its tallest. On a short screen it must still stop below the
// tool stack, scrolling inside instead of covering the measurement chip and its Clear button.
for (const { width, height } of [
  { width: 1100, height: 700 },
  { width: 1280, height: 700 },
  { width: 1440, height: 900 },
]) {
  test(`with every layer on, the open key clears the tool stack at ${width} x ${height}`, async ({
    page,
  }) => {
    const key = await openMap(page, width, height)
    const map = page.getByRole('navigation', { name: 'Map', exact: true })
    if (!(await map.isVisible())) await page.keyboard.press('[')
    for (const name of [
      'Elevation tint',
      'Contours',
      'Safety buffer',
      'Permitted zones',
      'Change since baseline',
    ]) {
      const s = map.getByRole('switch', { name })
      if ((await s.getAttribute('aria-checked')) !== 'true') await s.click()
      await expect(s).toHaveAttribute('aria-checked', 'true')
    }
    if ((await toggle(key).getAttribute('aria-expanded')) !== 'true') await toggle(key).click()
    const card = key.locator('.card')
    await expect(card).toBeVisible()
    const tools = (await page
      .getByRole('group', { name: 'Click tool' })
      .locator('xpath=..')
      .boundingBox())!
    const box = (await card.boundingBox())!
    // The cap leaves room for the tool stack at its tallest (status chip with a measurement).
    expect(box.y, 'key top below the tool stack').toBeGreaterThanOrEqual(tools.y + tools.height)
    expect(box.y, 'key top leaves the measurement chip room').toBeGreaterThanOrEqual(200)
  })
}

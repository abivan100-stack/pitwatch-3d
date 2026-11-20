import { expect, test, type Locator, type Page } from '@playwright/test'

// The colour key is a small "Map key" chip, closed on arrival at every width (issue #105). It sits
// under the Map card, or at the stage's bottom-left above the timeline when that card is folded or
// absent, and opens upward into a compact card that stays out of the model's way.

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

const toggle = (key: Locator) => key.getByRole('button', { name: 'Map key', exact: true })

for (const { width, height } of SIZES) {
  test(`the key is closed on arrival at ${width} px`, async ({ page }) => {
    const key = await openMap(page, width, height)
    await expect(toggle(key)).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle(key)).toHaveText('Map key')
    await expect(key.locator('.card')).toBeHidden()
  })
}

test('the open key is compact at 1440 x 900 and stays open for the session', async ({ page }) => {
  const key = await openMap(page, 1440, 900)
  await toggle(key).click()
  await expect(toggle(key)).toHaveAttribute('aria-expanded', 'true')
  // Default layers: Terrain and Findings on, so the aerial surfaces and the three finding shapes.
  for (const label of [
    'Scrub',
    'Haul road',
    'Lease boundary',
    'Warning',
    'Violation',
    'Critical',
  ]) {
    await expect(key.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(key.getByText('Simulated image; rule-engine marks')).toBeVisible()
  const card = (await key.locator('.card').boundingBox())!
  expect(card.width).toBeLessThanOrEqual(240)
  expect(card.height).toBeLessThanOrEqual(180)

  // Each entry is one line.
  for (const row of await key.locator('li').all()) {
    expect((await row.boundingBox())!.height, await row.innerText()).toBeLessThanOrEqual(22)
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

  // The choice lasts for the session: leave the map and come back.
  await page.evaluate(() => (location.hash = '#/overview'))
  await expect(key).toHaveCount(0)
  await page.evaluate(() => (location.hash = '#/monitor'))
  await expect(toggle(key)).toHaveAttribute('aria-expanded', 'true', { timeout: 60_000 })
})

test('the key rows follow the active layers', async ({ page }) => {
  const key = await openMap(page, 1440, 900)
  await toggle(key).click()
  const map = page.getByRole('navigation', { name: 'Map', exact: true })
  await expect(key.getByText('Violation', { exact: true })).toBeVisible()
  await map.getByRole('switch', { name: 'Findings' }).click()
  await expect(key.getByText('Violation', { exact: true })).toHaveCount(0)
  await expect(key.getByText('Warning', { exact: true })).toHaveCount(0)

  for (const b of await map.getByRole('button', { name: /\d+ more/ }).all()) await b.click()
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
  test(`the key toggles by keyboard at ${size.width} x ${size.height}`, async ({ page }) => {
    const key = await openMap(page, size.width, size.height)
    const button = toggle(key)
    await expect(button).toHaveAttribute('aria-expanded', 'false')
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

// The open key stays off the model: left of the stage's centre line and clear of every finding
// tag in the arrival (Oblique) view. A tag hangs beside the top of its pin, up to 75 px either way.
for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 1100, height: 700 },
]) {
  test(`the open key covers no finding tag at ${width} x ${height}`, async ({ page }) => {
    type ProbeWindow = Window & {
      __pitwatchProbe: { flights: unknown[]; pinTop?: (id: string) => { x: number; y: number } }
    }
    await page.addInitScript(() => {
      ;(window as unknown as ProbeWindow).__pitwatchProbe = { flights: [] }
    })
    const key = await openMap(page, width, height)
    await toggle(key).click()
    const card = (await key.locator('.card').boundingBox())!
    const stage = (await page.locator('.stage').boundingBox())!
    expect(card.x + card.width).toBeLessThanOrEqual(stage.x + stage.width / 2)

    const pins = () =>
      page.evaluate(() => {
        const top = (window as unknown as ProbeWindow).__pitwatchProbe.pinTop
        return top ? ['R1-1', 'R1-2', 'R2-1', 'R3-1', 'R1-3'].map((id) => top(id)) : null
      })
    await expect.poll(async () => (await pins())?.every(Boolean), { timeout: 60_000 }).toBe(true)
    for (const pin of (await pins())!) {
      const clear =
        pin.x + 75 <= card.x ||
        pin.x - 75 >= card.x + card.width ||
        pin.y + 30 <= card.y ||
        pin.y - 30 >= card.y + card.height
      expect(clear, `tag at ${Math.round(pin.x)}, ${Math.round(pin.y)}`).toBe(true)
    }
  })
}

test('folding the Map card with [ leaves the key where it is', async ({ page }) => {
  const key = await openMap(page, 1440, 900)
  await toggle(key).click()
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

// With every layer on, the key is at its tallest. It must still stop below the tool stack and the
// Map card (see the overlap checks), and take at most 45% of the stage, scrolling inside.
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
    for (const b of await map.getByRole('button', { name: /\d+ more/ }).all()) await b.click()
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
    // At most 45% of the stage, scrolling inside beyond that.
    const stage = (await page.locator('.stage').boundingBox())!
    expect(box.height).toBeLessThanOrEqual(stage.height * 0.45 + 0.5)
    expect(await card.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto')
  })
}

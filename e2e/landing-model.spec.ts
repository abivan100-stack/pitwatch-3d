import { expect, test, type Page } from '@playwright/test'

// The landing model (#72): smooth shading and a tone mapper, one before/after slider and two
// overlay switches in place of four stages, and a model anyone can turn, zoom and reset: by
// mouse, by touch, by keyboard and by buttons.
//
// No test can read a shader, so what the picture does is compared as canvas screenshots, and the
// camera is read from the model's own description, which has to follow the state anyway.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } })
// Each check here takes several canvas shots in software WebGL (about a frame a second on CI), so
// it gets the 180 s budget the other 3D specs use (apron, flight-exaggeration, terrain-picking).
test.describe.configure({ timeout: 180_000 })

const READY = { timeout: 60_000 }

const relativeChange = (a: Buffer, b: Buffer) => Math.abs(a.length - b.length) / a.length

/**
 * A shot of the middle of the model (the pit, two tags and the lease line) once the scene has drawn
 * what it was asked to. Software WebGL draws about a frame a second and a screenshot of the whole
 * canvas takes 20 s, so the comparison uses a small clip, about 8 s.
 */
async function shot(page: Page) {
  await page.waitForTimeout(2500)
  const box = (await page.locator('.hero-model canvas').boundingBox())!
  return page.screenshot({
    clip: {
      x: box.x + box.width * 0.25,
      y: box.y + box.height * 0.3,
      width: box.width * 0.4,
      height: box.height * 0.3,
    },
  })
}

async function openHome(page: Page) {
  await page.goto('/#/')
  const frame = page.getByRole('img', { name: /^3D model of the simulated mine block/ })
  await expect(frame).toBeVisible(READY)
  await expect(page.locator('.hero-model canvas')).toBeVisible(READY)
  await expect
    .poll(async () => (await page.locator('.hero-model canvas').boundingBox())?.width ?? 0, READY)
    .toBeGreaterThan(300)
  return frame
}

/**
 * Presses a key `n` times on the focused model in one browser round trip. Software WebGL leaves the
 * page a frame a second, and a real key press waits for the page, so a long run of single presses
 * would not fit the test's budget. A few real presses elsewhere prove the real keyboard path.
 */
const press = (page: Page, key: string, n = 1) =>
  page.evaluate(
    ([k, times]) => {
      const el = document.querySelector('.model-frame')!
      for (let i = 0; i < +times; i++)
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    },
    [key, n] as const,
  )

const label = (page: Page) => page.locator('.model-frame').getAttribute('aria-label')

test('the model uses smooth shading with a tone mapper', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __pitwatchProbe: object }).__pitwatchProbe = { flights: [] }
  })
  await openHome(page)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __pitwatchProbe: { landing?: { toneMapping: number } } })
              .__pitwatchProbe.landing?.toneMapping,
        ),
      READY,
    )
    // three's ACESFilmicToneMapping (4) or AgXToneMapping (6); 0 is none, which `flat` gave.
    .toBeGreaterThan(0)
})

test('one before/after slider and two overlay switches replace the four stages', async ({
  page,
}) => {
  await openHome(page)

  // The four stage buttons (1 Baseline, 2 Current, 3 Change, 4 Findings) are gone: nothing in the
  // controls is a pressed-state button any more, and no button is named Change or Findings.
  await expect(page.locator('.hero-controls [aria-pressed]')).toHaveCount(0)
  await expect(
    page.locator('.hero-controls').getByRole('button', { name: /Change|Findings/ }),
  ).toHaveCount(0)
  await expect(page.locator('.story-clock')).toHaveCount(0)
  const slider = page.getByRole('slider', { name: /Survey shown/ })
  const change = page.getByRole('switch', { name: 'Show change' })
  const findings = page.getByRole('switch', { name: 'Show permit findings' })
  const status = page.locator('.model-status')

  // It opens on the current survey with the findings, the change off.
  await expect(slider).toHaveValue('1')
  await expect(findings).toHaveAttribute('aria-checked', 'true')
  await expect(change).toHaveAttribute('aria-checked', 'false')
  await expect(status).toHaveText(/^Current survey, 22 Aug 2026, with simulated permit findings/)

  // Each switch changes the one sentence under it, and the model's description with it: the
  // canvas is a picture, so its text is what says what it shows.
  await findings.click()
  await expect(status).toHaveText('Current survey, 22 Aug 2026.')
  await expect(page.getByRole('list', { name: /permit findings shown/ })).toHaveCount(0)
  await change.click()
  await expect(status).toContainText('rust where rock was removed and blue where it was added')
  expect(await label(page)).toContain('rust where rock was removed')
})

test('the overlay switches change the picture', async ({ page }) => {
  await openHome(page)
  const findings = page.getByRole('switch', { name: 'Show permit findings' })
  const both = await shot(page)
  await findings.click()
  const none = await shot(page)
  expect(relativeChange(both, none), 'findings switch changes the model').toBeGreaterThan(0.005)
  await page.getByRole('switch', { name: 'Show change' }).click()
  const changed = await shot(page)
  expect(relativeChange(none, changed), 'change switch changes the model').toBeGreaterThan(0.02)
})

test('the slider labels the blend between the surveys an illustration', async ({ page }) => {
  await openHome(page)
  const slider = page.getByRole('slider', { name: /Survey shown/ })
  const status = page.locator('.model-status')

  await slider.fill('0.5')
  await expect(slider).toHaveAttribute('aria-valuetext', 'Illustration between the two surveys')
  await expect(status).toContainText('illustration between the two surveys, not a survey')
  expect(await label(page)).toContain('illustration')
  await slider.fill('0')
  await expect(slider).toHaveAttribute('aria-valuetext', 'Baseline survey, 14 Nov 2025')
  // The overlays are the current survey against the baseline: say so, instead of drawing them.
  await expect(status).toHaveText(
    'Baseline survey, 14 Nov 2025; the overlays show on the current survey.',
  )
  await expect(page.getByRole('list', { name: /permit findings shown/ })).toHaveCount(0)

  // The labels glide the slider to either end.
  await page.getByRole('button', { name: /^Current/ }).click()
  await expect(slider).toHaveValue('1', READY)
  await expect(status).toHaveText(/^Current survey, 22 Aug 2026, with simulated permit findings/)
})

test('the slider moves the picture between the surveys', async ({ page }) => {
  await openHome(page)
  const current = await shot(page)
  await page.getByRole('slider', { name: /Survey shown/ }).fill('0')
  const baseline = await shot(page)
  // Two shots of an unchanged frame differ by about 0.00002 (landing-terrain.spec.ts), so 0.002 is
  // still a hundred times the noise. CI measured 0.0049 for this change.
  expect(relativeChange(current, baseline), 'baseline differs from current').toBeGreaterThan(0.002)
})

test('the findings are named, and a ring and tag are drawn for them', async ({ page }) => {
  await openHome(page)
  // The tags are drawn in the canvas, so each has a name in the page: id, severity and rule.
  const list = page.getByRole('list', { name: /Simulated permit findings shown on the model/ })
  await expect(list.getByRole('listitem')).toHaveCount(5)
  await expect(list).toContainText('R1-1, critical violation, Lease boundary and buffer')
  await expect(list).toContainText('R2-1, violation, Approved pit floor')
  await expect(list).toContainText('R3-1, warning, Permitted dump zones')
})

test('the keyboard turns, tilts, zooms and resets the model', async ({ page }) => {
  const frame = await openHome(page)
  const start = await label(page)
  expect(start).toContain('from the south-east, 40° above the horizon, zoom 1.0×')
  expect(start).toContain('Arrow keys turn it, plus and minus zoom, 0 resets')
  const first = await shot(page)

  // Focusable, with a visible focus state.
  await page.keyboard.press('Tab')
  await frame.focus()
  await expect(frame).toBeFocused()
  const outline = await frame.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).not.toBe('none')

  // Right turns the model one way until it is looking at it from the south; it passes the
  // south-east on the way, so five presses is 0.6 rad, a little past it.
  await page.keyboard.press('ArrowRight')
  await press(page, 'ArrowRight', 4)
  expect(await label(page)).toContain('from the south, 40°')
  await press(page, 'ArrowLeft', 12)
  expect(await label(page)).toContain('from the east,')

  // Tilt and zoom are clamped: never under the ground, never closer than the block allows.
  await press(page, 'ArrowDown', 8)
  expect(await label(page)).toContain('15° above the horizon')
  await press(page, 'ArrowUp', 16)
  expect(await label(page)).toContain('75° above the horizon')
  await page.keyboard.press('+')
  expect(await label(page)).toContain('zoom 1.3×')
  await press(page, '=', 7)
  expect(await label(page)).toContain('zoom 4.0×')
  await press(page, '-', 9)
  expect(await label(page)).toContain('zoom 1.0×')

  // 0 puts everything back, and the picture with it.
  await press(page, 'ArrowLeft', 4)
  await page.keyboard.press('+')
  await page.keyboard.press('0')
  expect(await label(page)).toBe(start)
  const reset = await shot(page)
  expect(relativeChange(first, reset), 'reset restores the framed view').toBeLessThan(0.01)
})

test('drag turns and tilts the model, and a double click resets it', async ({ page }) => {
  const frame = await openHome(page)
  const start = await label(page)
  const box = (await frame.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // A mouse drags in both directions.
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 160, cy + 60, { steps: 8 })
  await page.mouse.up()
  const dragged = await label(page)
  expect(dragged).not.toBe(start)
  expect(dragged).not.toContain('40° above')

  await frame.dblclick()
  expect(await label(page)).toBe(start)
})

test('the wheel zooms only once the model has focus, and gives the page back at the limit', async ({
  page,
}) => {
  const frame = await openHome(page)
  const box = (await frame.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  // A bare wheel over the picture scrolls the page. Once the model has focus, it zooms.
  await frame.evaluate((el) => (el as HTMLElement).blur())
  await page.mouse.move(cx, cy)
  await page.mouse.wheel(0, -400)
  expect(await label(page)).toContain('zoom 1.0×')
  await frame.focus()
  await page.mouse.wheel(0, -400)
  await expect.poll(() => label(page)).toMatch(/zoom 1\.[1-9]|zoom [2-4]\./)
  await page.mouse.wheel(0, 4000)
  expect(await label(page)).toContain('zoom 1.0×')
  // At the zoom limit the wheel scrolls the page again, though the model still has focus.
  const top = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, 400)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(top)
})

test('a scale bar and a north arrow turn with the model', async ({ page }) => {
  const frame = await openHome(page)
  const chip = page.locator('.model-scale')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(/(100|200|500) m|1 km/)
  const needle = chip.locator('g[transform]')
  const before = await needle.getAttribute('transform')
  expect(before).toMatch(/^rotate\(/)

  await frame.focus()
  await press(page, 'ArrowLeft', 6)
  await expect.poll(() => needle.getAttribute('transform')).not.toBe(before)
  // Zoomed in, the same bar stands for a shorter distance.
  const wide = (await chip.innerText()).trim()
  await press(page, '+', 8)
  await expect.poll(async () => (await chip.innerText()).trim()).not.toBe(wide)
})

test('the model stops rendering when it is scrolled out of view', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __pitwatchProbe: object }).__pitwatchProbe = { flights: [] }
  })
  await openHome(page)
  const frames = () =>
    page.evaluate(
      () =>
        (window as unknown as { __pitwatchProbe: { landing?: { frames: number } } }).__pitwatchProbe
          .landing?.frames ?? 0,
    )
  await expect.poll(frames, READY).toBeGreaterThan(1)
  await page.evaluate(() => document.querySelector('.landing')!.scrollTo(0, 99999))
  await expect(page.locator('.hero-stage')).not.toBeInViewport()
  await page.waitForTimeout(2500)
  const stopped = await frames()
  await page.waitForTimeout(3000)
  expect(await frames(), 'no frames drawn while off screen').toBe(stopped)
  await page.evaluate(() => document.querySelector('.landing')!.scrollTo(0, 0))
  await expect.poll(frames, READY).toBeGreaterThan(stopped)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  // One button press is 20 degrees, finer than the description's eight compass points, so the
  // north arrow is what shows each press.
  const needleOf = (page: Page) => page.locator('.model-scale g[transform]')

  test('two buttons turn the model, and a third resets it', async ({ page }) => {
    await openHome(page)
    const turn = page.getByRole('group', { name: 'Turn the model' })
    const left = turn.getByRole('button', { name: 'Turn left' })
    const right = turn.getByRole('button', { name: 'Turn right' })
    await expect(left).toBeVisible()
    await expect(right).toBeVisible()
    await expect(turn.getByRole('button', { name: 'Reset view' })).toBeVisible()
    // Inside the picture, big enough to hit, and clear of the scale bar.
    const stage = (await page.locator('.hero-model').boundingBox())!
    const [l, r, chip] = await Promise.all([
      left.boundingBox(),
      right.boundingBox(),
      page.locator('.model-scale').boundingBox(),
    ])
    for (const b of [l!, r!]) {
      expect(b.x).toBeGreaterThanOrEqual(stage.x)
      expect(b.x + b.width).toBeLessThanOrEqual(stage.x + stage.width)
      expect(b.width).toBeGreaterThanOrEqual(36)
    }
    expect(chip!.x + chip!.width).toBeLessThanOrEqual(l!.x)

    const needle = needleOf(page)
    const start = await label(page)
    const north = await needle.getAttribute('transform')
    await left.click()
    await expect.poll(() => needle.getAttribute('transform'), READY).not.toBe(north)
    const afterLeft = await needle.getAttribute('transform')
    await right.click()
    await right.click()
    await expect.poll(() => needle.getAttribute('transform'), READY).not.toBe(afterLeft)
    await turn.getByRole('button', { name: 'Reset view' }).click()
    await expect.poll(() => needle.getAttribute('transform'), READY).toBe(north)
    expect(await label(page)).toBe(start)
  })

  /** A touch swipe from the middle of the model, through the browser's own input path. */
  async function swipe(page: Page, dx: number, dy: number) {
    const box = (await page.locator('.model-frame').boundingBox())!
    const x = Math.round(box.x + box.width / 2)
    const y = Math.round(box.y + box.height / 2)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 5; i++) {
      const touchPoints = [{ x: x + (dx * i) / 5, y: y + (dy * i) / 5 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }

  test('a sideways swipe on the model turns it', async ({ page }) => {
    await openHome(page)
    const needle = needleOf(page)
    const north = await needle.getAttribute('transform')
    await swipe(page, -120, 0)
    await expect.poll(() => needle.getAttribute('transform'), READY).not.toBe(north)
  })

  test('a vertical swipe on the model still scrolls the page, and does not turn it', async ({
    page,
  }) => {
    await openHome(page)
    const needle = needleOf(page)
    const north = await needle.getAttribute('transform')
    const scroller = page.locator('.landing')
    const top = await scroller.evaluate((el) => el.scrollTop)
    await swipe(page, 0, -300)
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop), READY)
      .toBeGreaterThan(top + 100)
    expect(await needle.getAttribute('transform')).toBe(north)
  })
})

import { expect, test } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

test('Show on map restores the current terrain, finding layer, and selected evidence', async ({
  page,
}) => {
  // The map now renders the 513 × 513 terrain while this test changes routes repeatedly.
  test.setTimeout(60_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/monitor')

  const map = page.getByRole('navigation', { name: 'Map', exact: true })
  const terrain = map.getByRole('switch', { name: 'Terrain' })
  const findings = map.getByRole('switch', { name: 'Findings' })
  await expect(terrain).toBeEnabled({ timeout: 60_000 })
  await page.getByRole('button', { name: /Baseline/ }).click()
  await terrain.click()
  await findings.click()
  await expect(page.locator('.scene-wrap')).toHaveAttribute(
    'aria-label',
    /baseline survey\. Terrain is hidden\. Findings are not shown on the baseline survey\./i,
  )

  const detailsToggle = page.getByRole('button', { name: 'Details panel' })
  await detailsToggle.click()
  await expect(detailsToggle).toHaveAttribute('aria-pressed', 'false')

  const nav = page.getByRole('navigation', { name: 'Dashboard' })
  await nav.getByRole('link', { name: 'Findings' }).click()
  const cards = page.locator('li.frow')
  await expect(cards).toHaveCount(5, { timeout: 60_000 })
  await cards.first().getByRole('button', { name: 'Show on map' }).click()

  await expect(page).toHaveURL(/#\/monitor(\?finding=[\w-]+)?$/)
  await expect(page.getByRole('slider', { name: 'Survey shown on the map' })).toHaveAttribute(
    'aria-valuetext',
    'Current survey',
  )
  await expect(terrain).toHaveAttribute('aria-checked', 'true')
  await expect(findings).toHaveAttribute('aria-checked', 'true')
  await expect(detailsToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#details-tabpanel li.finding[data-selected]')).toHaveCount(1)
  await expect(page.locator('#details-tabpanel li.finding[data-selected]')).toContainText('R1-1')
  await expect(page.locator('.scene-wrap')).toHaveAttribute(
    'aria-label',
    /current survey\. Terrain is visible\. Findings overlay is on, with 5 findings marked\. Finding R1-1 selected\./i,
  )
  await expect(page.locator('.map-chip').filter({ hasText: 'at centre' })).toHaveText(
    /(?:20|50) m at centre/,
  )

  // A second selection must replace the first throughout the list and map description.
  await nav.getByRole('link', { name: 'Findings' }).click()
  await page.locator('li.frow').nth(1).getByRole('button', { name: 'Show on map' }).click()
  await expect(page.locator('#details-tabpanel li.finding[data-selected]')).toContainText('R2-1')
  await expect(page.locator('.scene-wrap')).toHaveAttribute(
    'aria-label',
    /Finding R2-1 selected\./i,
  )

  await nav.getByRole('link', { name: 'Overview' }).click()
  await expect(page.locator('li.attention[data-selected]')).toContainText('R2-1')
  const plan = page.getByRole('group', { name: /Plan of the mine from above/ })
  await expect(plan.getByRole('button', { name: /^R2-1,/ })).toHaveAttribute('aria-pressed', 'true')

  await plan.getByRole('button', { name: /^R1-3,/ }).click()
  await expect(page).toHaveURL(/#\/monitor(\?finding=[\w-]+)?$/)
  await expect(page.locator('#details-tabpanel li.finding[data-selected]')).toContainText('R1-3')
  await nav.getByRole('link', { name: 'Findings' }).click()
  await expect(page.locator('li.frow[data-selected]')).toContainText('R1-3')
})

test('the phone map clears the drawer after selection and keeps the finding on reopen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/monitor')

  const toggle = page.locator('button[aria-controls="side-panel"]')
  const drawer = page.getByRole('complementary', { name: 'Details' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('li.finding')).toHaveCount(5, { timeout: 60_000 })

  await drawer.locator('li.finding').nth(1).getByRole('button', { name: 'Show on map' }).click()

  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(drawer).toBeHidden()
  await expect(page.locator('.scene-wrap')).toHaveAttribute(
    'aria-label',
    /Finding R2-1 selected\./i,
  )

  await toggle.click()
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('li.finding[data-selected]')).toContainText('R2-1')
})

/* ---------- Show on map: the flight to a finding (#80) ---------- */

type V3 = [number, number, number]
interface Probe {
  flights: { start: number; ms: number; end?: number; early?: number }[]
  cameraState?: { subscribe: (fn: () => void) => () => void }
  pose?: () => { position: V3; target: V3 }
  pinTop?: (id: string) => { x: number; y: number } | null
  framed?: string
}
type ProbeWindow = Window & { __pitwatchProbe: Probe; __writes: number }

/** Opts the page into the camera probe (`src/scene/probe.ts`); visitors never have it. */
const withProbe = () => {
  ;(window as unknown as ProbeWindow).__pitwatchProbe = { flights: [] }
}

const IDS = ['R1-1', 'R1-2', 'R2-1', 'R3-1', 'R1-3']

test.describe('with full motion', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('Show on map lands each finding in the middle of the stage, quickly and in one store write', async ({
    page,
  }) => {
    // Software WebGL draws about one frame a second, and the check makes five flights.
    test.setTimeout(240_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.addInitScript(withProbe)
    await page.goto('/#/monitor')
    const cards = page.locator('#details-tabpanel li.finding')
    await expect(cards).toHaveCount(5, { timeout: 60_000 })

    const probe = () => page.evaluate(() => (window as unknown as ProbeWindow).__pitwatchProbe)
    // The opening shot is the unchanged 2.6 s intro; wait for it to land.
    await expect.poll(async () => (await probe()).flights[0]?.end, { timeout: 60_000 }).toBeTruthy()
    expect((await probe()).flights[0].ms).toBe(2600)
    await page.evaluate(() => {
      const w = window as unknown as ProbeWindow
      w.__writes = 0
      w.__pitwatchProbe.cameraState!.subscribe(() => w.__writes++)
    })

    const stage = (await page.locator('.stage').boundingBox())!
    for (const [n, id] of IDS.entries()) {
      const button = cards.filter({ hasText: id }).getByRole('button', { name: 'Show on map' })
      const clickedAt = await button.evaluate((el) => {
        ;(window as unknown as ProbeWindow).__writes = 0
        const t = performance.now()
        ;(el as HTMLButtonElement).click()
        return t
      })
      await expect.poll(async () => (await probe()).flights.length, { timeout: 10_000 }).toBe(n + 2)
      await expect
        .poll(async () => (await probe()).flights.at(-1)!.end, { timeout: 30_000 })
        .toBeTruthy()
      // One more frame, so a write that a late frame or the controls' damping makes is counted.
      await page.waitForTimeout(1500)
      const flight = (await probe()).flights.at(-1)!

      // The animation is planned to end within 1 s of the click (0.7 s for the 34 m hop from
      // R1-1 to R1-2). Software WebGL draws the landing frame up to a second later, so the
      // planned end is what is measured, not the frame.
      expect(flight.start).toBeGreaterThanOrEqual(clickedAt)
      expect(flight.start + flight.ms - clickedAt).toBeLessThanOrEqual(id === 'R1-2' ? 700 : 1000)
      // Ease-out: the camera's own easing covers at least 15% of the distance in the first 100 ms.
      expect(flight.early).toBeGreaterThanOrEqual(0.15)
      // The camera store (scale bar, compass) is written once, when the flight lands.
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__writes)).toBe(1)

      // The pin head sits in the central 40% of the stage. The badge hangs up to 35 px to one
      // side of its stick, so both sides must be in the band.
      const head = (await page.evaluate(
        (id) => (window as unknown as ProbeWindow).__pitwatchProbe.pinTop!(id),
        id,
      ))!
      for (const x of [head.x - 35, head.x + 35]) {
        expect(x, `${id} badge x`).toBeGreaterThanOrEqual(stage.x + stage.width * 0.3)
        expect(x, `${id} badge x`).toBeLessThanOrEqual(stage.x + stage.width * 0.7)
      }
      expect(head.y, `${id} badge y`).toBeGreaterThanOrEqual(stage.y + stage.height * 0.3)
      expect(head.y, `${id} badge y`).toBeLessThanOrEqual(stage.y + stage.height * 0.7)
      await expect(page.locator('.scene-wrap')).toHaveAttribute(
        'aria-label',
        new RegExp(`Finding ${id} selected\\.`),
      )
    }

    // The preset flights keep their 1.3 s.
    const camera = page.getByRole('group', { name: 'Camera view' })
    for (const [n, name] of ['Oblique', 'Top', 'Pit'].entries()) {
      await camera.getByRole('button', { name }).click()
      await expect
        .poll(async () => (await probe()).flights.length, { timeout: 10_000 })
        .toBe(IDS.length + 2 + n)
      expect((await probe()).flights.at(-1)!.ms).toBe(1300)
    }
  })
})

test('the Findings page, the Overview, the map and a shared link frame a finding the same way, with no flight under reduced motion', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(withProbe)
  // The buffer-edge strip, and one of the three the Overview lists first.
  const id = 'R1-2'
  const selected = page.locator('#details-tabpanel li.finding[data-selected]')
  const nav = page.getByRole('navigation', { name: 'Dashboard' })
  const pose = () => page.evaluate(() => (window as unknown as ProbeWindow).__pitwatchProbe.pose!())

  const poses: { position: V3; target: V3 }[] = []
  const landed = async () => {
    await expect(selected).toContainText(id, { timeout: 60_000 })
    await expect
      .poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pitwatchProbe.framed), {
        timeout: 60_000,
      })
      .toBe(id)
    // Reduced motion jumps straight to the framed view: no flight is ever started.
    expect(
      await page.evaluate(() => (window as unknown as ProbeWindow).__pitwatchProbe.flights.length),
    ).toBe(0)
    poses.push(await pose())
  }

  // A shared link, on a fresh load.
  await page.goto(`/#/monitor?finding=${id}`)
  await landed()

  // The Findings page.
  await page.goto('/#/findings')
  await page
    .locator('li.frow')
    .filter({ hasText: id })
    .getByRole('button', { name: 'Show on map' })
    .click()
  await landed()

  // The Overview.
  await nav.getByRole('link', { name: 'Overview' }).click()
  await page
    .locator('li.attention')
    .filter({ hasText: id })
    .getByRole('button', { name: 'Show on map' })
    .click()
  await landed()

  // The map's own Findings tab, after looking at another finding first.
  const cards = page.locator('#details-tabpanel li.finding')
  await cards.filter({ hasText: 'R1-1' }).getByRole('button', { name: 'Show on map' }).click()
  await expect(selected).toContainText('R1-1')
  await cards.filter({ hasText: id }).getByRole('button', { name: 'Show on map' }).click()
  await landed()

  expect(poses).toHaveLength(4)
  for (const p of poses.slice(1)) {
    for (const k of ['position', 'target'] as const) {
      expect(Math.hypot(...p[k].map((v, i) => v - poses[0][k][i]))).toBeLessThan(0.5)
    }
  }
})

import { expect, test, type Page } from '@playwright/test'
import type { TerrainSurvey } from '../src/domain/types.js'

// Most cases drive the Inspector coordinate form with the keyboard. The announcement regression
// also clicks the terrain to verify that a pointer pick supersedes the form's last submission.

test.use({ reducedMotion: 'reduce' })

/** Waits for the worker-built surveys; the camera group only renders once they are ready. */
async function openMonitor(page: Page) {
  await page.goto('/#/monitor')
  await expect(page.getByRole('group', { name: 'Camera view' })).toBeVisible({ timeout: 60_000 })
}

/** Opens the Inspector tab from the keyboard. */
async function openInspector(page: Page) {
  const tab = page.getByRole('tab', { name: 'Inspector' })
  await tab.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('East', { exact: true })).toBeVisible()
}

/** Fills both fields, moving East -> North with Tab, and submits with Enter in North. */
async function enterCoordinate(page: Page, east: string, north: string) {
  await page.getByLabel('East', { exact: true }).focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(east)
  await page.keyboard.press('Tab')
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type(north)
  await page.keyboard.press('Enter')
}

test('a typed coordinate reads the point and announces it', async ({ page }) => {
  await openMonitor(page)
  await openInspector(page)

  const east = page.getByLabel('East', { exact: true })
  const north = page.getByLabel('North', { exact: true })
  const submit = page.getByRole('button', { name: 'Read point' })

  // East -> North -> submit is the tab order, and Enter in either field submits.
  await east.focus()
  await expect(east).toBeFocused()
  await page.keyboard.type('1024')
  await page.keyboard.press('Tab')
  await expect(north).toBeFocused()
  await page.keyboard.type('900')
  await page.keyboard.press('Tab')
  await expect(submit).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(north).toBeFocused()
  await page.keyboard.press('Enter')

  // The Inspector reports the point, exactly as a click there would.
  await expect(page.getByText('Selected point')).toBeVisible()
  await expect(
    page.locator('#details-tabpanel dd').filter({ hasText: 'E 1,024.00 m, N 900.00 m' }),
  ).toBeVisible()
  await expect(
    page.getByText('The elevation readings and change quote vertical uncertainty.'),
  ).toBeVisible()

  const pointChange = page
    .getByRole('term')
    .filter({ hasText: /^Point change$/ })
    .locator('xpath=following-sibling::dd')
  await expect(pointChange).toHaveText(/^[+−]\d+\.\d{2} ± 0\.07 m$/)

  // The live region carries the outcome for a screen reader.
  await expect(page.locator('form').getByRole('status')).toHaveText('Read E 1,024 m, N 900 m.')
})

test('typed coordinates set measure A and B and produce a distance', async ({ page }) => {
  // Give the baseline a distinct uncertainty at the survey-provider boundary so a legend that
  // accidentally reuses the current survey's value cannot pass.
  await page.addInitScript(() => {
    const SurveyWorker = window.Worker
    window.Worker = class extends SurveyWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        this.addEventListener('message', ({ data }: MessageEvent<{ survey?: TerrainSurvey }>) => {
          if (data.survey?.id === 'baseline') data.survey.verticalUncertainty = 0.08
        })
      }
    }
  })
  await openMonitor(page)

  // `m` toggles the tool from the page, not from a pointer.
  await page.keyboard.press('m')
  await openInspector(page)
  await expect(page.getByRole('button', { name: 'Measure' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await enterCoordinate(page, '900', '800')
  await expect(page.getByText('Point A is set at E 900 m, N 800 m.')).toBeVisible()

  await enterCoordinate(page, '1100', '800')
  // A complete measurement now renders the rows the inspector shows after two clicks.
  await expect(page.locator('#details-tabpanel dt', { hasText: 'Horizontal' })).toBeVisible()
  await expect(page.locator('#details-tabpanel dt', { hasText: 'Average grade' })).toBeVisible()
  // The distance carries the horizontal error of its two endpoints, not the vertical one.
  await expect(
    page.locator('#details-tabpanel dd').filter({ hasText: '200.0 m ± 0.14 m' }),
  ).toBeVisible()
  // The grade quotes its own propagated error, as the footer says.
  await expect(
    page
      .locator('#details-tabpanel div')
      .filter({ has: page.locator('dt', { hasText: 'Average grade' }) })
      .locator('dd')
      .first(),
  ).toContainText('±')
  const elevationChange = page
    .getByText('Elevation change', { exact: true })
    .locator('xpath=following-sibling::dd')
  await expect(elevationChange).toContainText('± 0.07 m')
  await expect(page.getByText(/Elevation change combines two vertical readings/)).toContainText(
    '±0.05 m each to give ±0.07 m',
  )
  const profileLegend = page.locator('#details-tabpanel figcaption')
  await expect(profileLegend).toContainText('Current, ±0.05 m')
  await expect(profileLegend).toContainText('Baseline, ±0.08 m')
})

test('a point reading quotes horizontal error and refuses an unconfirmable side', async ({
  page,
}) => {
  await openMonitor(page)
  await openInspector(page)

  const reading = page.locator('#details-tabpanel dd')
  await enterCoordinate(page, '240.30', '220.30')
  await expect(reading.filter({ hasText: 'E 240.30 m, N 220.30 m ± 0.10 m' })).toBeVisible()
  await expect(
    reading.filter({ hasText: 'Inside, 0.29 m from the boundary ±0.10 m' }),
  ).toBeVisible()

  await enterCoordinate(page, '239.70', '219.70')
  await expect(reading.filter({ hasText: 'E 239.70 m, N 219.70 m ± 0.10 m' })).toBeVisible()
  await expect(
    reading.filter({ hasText: 'Outside, 0.42 m from the boundary ±0.10 m' }),
  ).toBeVisible()

  await enterCoordinate(page, '240', '220')
  await expect(reading.filter({ hasText: 'E 240.00 m, N 220.00 m ± 0.10 m' })).toBeVisible()
  await expect(reading.filter({ hasText: 'Side cannot be confirmed' })).toContainText(
    '0.00 m from the boundary, within the 0.20 m (2σ) horizontal error band',
  )
})

test('a coordinate outside the grid is applied and reported honestly', async ({ page }) => {
  await openMonitor(page)
  await openInspector(page)

  await enterCoordinate(page, '2400', '1200')

  // It is still read, so the panel is not empty: the position is real, the elevation is not.
  await expect(page.getByText('Selected point')).toBeVisible()
  await expect(
    page.locator('#details-tabpanel dd').filter({ hasText: 'E 2,400.00 m, N 1,200.00 m' }),
  ).toBeVisible()
  const elevation = page
    .locator('#details-tabpanel dt', { hasText: 'Elevation' })
    .locator('xpath=following-sibling::dd')
  await expect(elevation).toHaveText('—')

  // The form says what cannot be known instead of leaving a silent blank, and the reading below
  // does not claim "no significant change" when it could not measure one.
  const status = page.locator('form').getByRole('status')
  await expect(status).toContainText('outside the survey grid')
  await expect(status).toContainText('elevations cannot be')
  await expect(page.getByText('No significant change')).toHaveCount(0)
  await expect(
    page.getByText('No reading here: the point is outside the survey grid.'),
  ).toBeVisible()
})

test('coordinate announcements clear on a terrain pick, tool switch, and Clear', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openMonitor(page)
  await openInspector(page)
  const status = page.locator('form').getByRole('status')
  const east = page.getByLabel('East', { exact: true })
  const north = page.getByLabel('North', { exact: true })
  const measure = page.getByRole('button', { name: 'Measure', exact: true })

  const readOutside = async () => {
    await enterCoordinate(page, '5000', '5000')
    await expect(status).toContainText('E 5,000 m, N 5,000 m is outside the survey grid')
  }

  await readOutside()
  await page.getByRole('switch', { name: 'Findings', exact: true }).click()
  await page.getByRole('button', { name: 'Top', exact: true }).click()
  const stage = await page.locator('.stage').boundingBox()
  if (!stage) throw new Error('The map stage is missing')
  const x = stage.x + stage.width * 0.45
  const y = stage.y + stage.height * 0.38
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
  await expect(east).not.toHaveValue('5000')
  await expect(north).not.toHaveValue('5000')
  await expect(
    page.getByText('No reading here: the point is outside the survey grid.'),
  ).toHaveCount(0)
  await expect(status).toBeEmpty()

  await readOutside()
  await measure.focus()
  await page.keyboard.press('m')
  await expect(measure).toHaveAttribute('aria-pressed', 'true')
  await expect(east).toHaveValue('')
  await expect(north).toHaveValue('')
  await expect(status).toBeEmpty()

  await page.keyboard.press('m')
  await expect(measure).toHaveAttribute('aria-pressed', 'false')
  await expect(east).toHaveValue('5000')
  await expect(status).toBeEmpty()
  await readOutside()
  await page.getByRole('button', { name: 'Clear point', exact: true }).click()
  await expect(east).toHaveValue('')
  await expect(north).toHaveValue('')
  await expect(status).toBeEmpty()
})

test('a very long typed measurement is refused instead of profiled', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', (e) => failures.push(String(e)))

  await openMonitor(page)
  await page.keyboard.press('m')
  await openInspector(page)

  // A on the survey corner, B a million kilometres east. The line used to be profiled at every
  // half cell: 250 million samples, built twice (Inspector and map line), which exhausted the
  // browser long before it could say the line cannot be read.
  await enterCoordinate(page, '0', '0')
  await enterCoordinate(page, '1000000000', '0')

  // The panel says the line cannot be read, and no measurement is offered.
  await expect(
    page.getByText('One end is outside the survey area. Click another point.'),
  ).toBeVisible()
  await expect(page.locator('#details-tabpanel dt', { hasText: 'Horizontal' })).toHaveCount(0)

  // The form says where the point is, and the page is still alive.
  const status = page.locator('form').getByRole('status')
  await expect(status).toContainText('outside the survey grid')
  await expect(page.getByRole('group', { name: 'Camera view' })).toBeVisible()
  expect(failures).toEqual([])
})

test('Escape closes the navigation drawer before clearing a map measurement', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await openMonitor(page)
  await page.keyboard.press('m')
  await page.getByRole('button', { name: 'Details', exact: true }).click()
  await openInspector(page)
  await enterCoordinate(page, '900', '800')
  await enterCoordinate(page, '1100', '800')

  const distance = page.getByText('200.0 m ± 0.14 m', { exact: true })
  await expect(distance).toBeVisible()
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  await menu.click()
  const nav = page.getByRole('navigation', { name: 'Dashboard' })
  await expect(nav).toBeVisible()
  await expect(page.locator('#sidebar :focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(nav).toBeHidden()
  await expect(menu).toBeFocused()
  await expect(distance).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(distance).toHaveCount(0)
})

test('navigation drawer blocks map shortcuts and releases them at desktop width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 })
  await openMonitor(page)

  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const nav = page.getByRole('navigation', { name: 'Dashboard' })
  const map = page.locator('.monitor')
  const measure = page.getByRole('button', { name: 'Measure', exact: true })
  await expect(map).toHaveAttribute('data-layers', 'hidden')
  await expect(map).toHaveAttribute('data-details', 'hidden')
  await expect(measure).toHaveAttribute('aria-pressed', 'false')

  await menu.click()
  await expect(nav).toBeVisible()
  await expect(page.locator('#sidebar :focus')).toHaveCount(1)
  await page.keyboard.press('m')
  await page.keyboard.press('[')
  await page.keyboard.press(']')
  await expect(measure).toHaveAttribute('aria-pressed', 'false')
  await expect(map).toHaveAttribute('data-layers', 'hidden')
  await expect(map).toHaveAttribute('data-details', 'hidden')

  await page.setViewportSize({ width: 1100, height: 900 })
  await expect(menu).toBeHidden()
  await expect(page.locator('.shell')).not.toHaveAttribute('data-menu', 'true')
  const layersButton = page.getByRole('button', { name: 'Map panel' })
  const detailsButton = page.getByRole('button', { name: 'Details panel' })
  await expect(layersButton).toHaveAttribute('aria-pressed', 'true')
  await expect(detailsButton).toHaveAttribute('aria-pressed', 'false')

  await page.keyboard.press('m')
  await expect(measure).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('[')
  await expect(layersButton).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press(']')
  await expect(detailsButton).toHaveAttribute('aria-pressed', 'true')

  await page.setViewportSize({ width: 800, height: 900 })
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await expect(nav).toBeHidden()
})

test('the coordinate form fits the phone drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openMonitor(page)

  await page.getByRole('button', { name: 'Details' }).click()
  const drawer = page.getByRole('complementary', { name: 'Details' })
  await expect(drawer).toBeVisible()
  await page.getByRole('tab', { name: 'Inspector' }).click()

  const form = page.locator('form')
  await expect(form).toBeVisible()
  await expect(page.getByLabel('East', { exact: true })).toBeVisible()
  await expect(page.getByLabel('North', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Read point' })).toBeVisible()

  // No horizontal overflow: the form's box stays inside the drawer and it does not scroll
  // sideways at 390 px.
  const [box, panel] = await Promise.all([form.boundingBox(), drawer.boundingBox()])
  expect(box).not.toBeNull()
  expect(panel).not.toBeNull()
  expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 0.5)
  expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
})

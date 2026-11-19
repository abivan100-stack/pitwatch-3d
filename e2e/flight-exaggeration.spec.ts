import { expect, test, type Page } from '@playwright/test'

// A camera flight ends at the right depth when exaggeration changes mid-flight (#60). The
// flight's poses were taken at the old scale; the rescale moved the current aim point, then the
// next flight frame put it back, so the camera settled on the old floor depth. Flights need full
// motion, so this file does not ask for reduced motion.

test.use({ viewport: { width: 1440, height: 900 } })
// Software WebGL is slow to screenshot, and each check waits for the canvas to settle.
test.describe.configure({ timeout: 180_000 })

/**
 * Waits until the demand-driven canvas has not changed for 2.5 s, then returns its pixels as
 * base64 PNG. Software WebGL draws about one frame a second, so two equal shots a moment apart
 * can both fall between frames of a flight that is still running.
 */
async function settledShot(page: Page) {
  const canvas = page.locator('.scene-wrap canvas')
  let last = ''
  let since = Date.now()
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const shot = (await canvas.screenshot()).toString('base64')
    if (shot !== last) {
      last = shot
      since = Date.now()
    } else if (Date.now() - since >= 2500) return shot
    await page.waitForTimeout(300)
  }
  throw new Error('the canvas never settled')
}

/** Share of pixels that differ visibly between two PNG screenshots of the same size. */
async function differingShare(page: Page, a: string, b: string) {
  return page.evaluate(
    async ([a, b]) => {
      const read = async (b64: string) => {
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
        const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const cv = new OffscreenCanvas(img.width, img.height)
        const cx = cv.getContext('2d')!
        cx.drawImage(img, 0, 0)
        return cx.getImageData(0, 0, img.width, img.height).data
      }
      const [p, q] = [await read(a), await read(b)]
      let n = 0
      for (let i = 0; i < p.length; i += 4) {
        const d =
          Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2])
        if (d > 40) n++
      }
      return n / (p.length / 4)
    },
    [a, b] as const,
  )
}

/**
 * Lets a test slow the page clock. Flights are timed with `performance.now()`, and software WebGL
 * draws about one frame a second, so at full speed a 1.3 s flight is over before a test can act
 * between its frames. Time stays continuous when the rate changes.
 */
function slowableClock() {
  const real = performance.now.bind(performance)
  let at = real()
  let base = at
  let rate = 1
  const w = window as unknown as { __timeRate: (r: number) => void }
  w.__timeRate = (r: number) => {
    const now = real()
    base += (now - at) * rate
    at = now
    rate = r
  }
  performance.now = () => base + (real() - at) * rate
}

async function openAtRest(page: Page) {
  await page.addInitScript(slowableClock)
  await page.goto('/#/monitor')
  const camera = page.getByRole('group', { name: 'Camera view' })
  await expect(camera).toBeVisible({ timeout: 60_000 })
  const slider = page
    .getByRole('navigation', { name: 'Map', exact: true })
    .getByLabel('Vertical exaggeration')
  await expect(slider).toHaveValue('1.5')
  // Let the 2.6 s intro flight finish, so only the Pit flight below is in progress.
  await settledShot(page)
  return { camera, slider }
}

/** The Pit preset requested at 3x with nothing changing during its flight. */
async function pitAt3x(page: Page, camera: ReturnType<Page['getByRole']>) {
  await camera.getByRole('button', { name: 'Oblique' }).click()
  await settledShot(page)
  await camera.getByRole('button', { name: 'Pit' }).click()
  return settledShot(page)
}

test('changing exaggeration while the Pit flight is under way lands on the Pit view at the new scale', async ({
  page,
}) => {
  const { camera, slider } = await openAtRest(page)
  // The middle of the stage: model only, no HUD control, so a change there is the camera moving.
  const stage = (await page.locator('.stage').boundingBox())!
  const middle = {
    x: stage.x + stage.width / 2 - 100,
    y: stage.y + stage.height / 2 - 100,
    width: 200,
    height: 200,
  }
  const view = async () => (await page.screenshot({ clip: middle })).toString('base64')
  const before = await view()

  // At 1/20 speed the 1.3 s flight takes about 26 s. Once the model has moved, the flight is
  // running and far from its end, and the scale changes in the middle of it.
  await page.evaluate(() =>
    (window as unknown as { __timeRate: (r: number) => void }).__timeRate(0.05),
  )
  await camera.getByRole('button', { name: 'Pit' }).click()
  await expect.poll(async () => (await view()) !== before, { timeout: 20_000 }).toBe(true)
  await slider.evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '3')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(slider).toHaveValue('3')
  await page.evaluate(() =>
    (window as unknown as { __timeRate: (r: number) => void }).__timeRate(1),
  )
  const changedInFlight = await settledShot(page)

  // Same pose, same frame. Before #60 the camera aimed about 120 m above the reference (the 1.5x
  // floor depth), and most of the frame differed.
  expect(await differingShare(page, changedInFlight, await pitAt3x(page, camera))).toBeLessThan(
    0.01,
  )
})

test('a Pit request and a scale change handled together land on the Pit view at the new scale', async ({
  page,
}) => {
  const { camera, slider } = await openAtRest(page)
  // One page task: the scene's React root can commit the request and the new scale in one
  // render. The Pit pose is then built at the new scale and must not be scaled a second time.
  const pit = await camera.getByRole('button', { name: 'Pit' }).elementHandle()
  await slider.evaluate((el, button) => {
    ;(button as HTMLButtonElement).click()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '3')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, pit)
  await expect(slider).toHaveValue('3')
  const changed = await settledShot(page)
  expect(await differingShare(page, changed, await pitAt3x(page, camera))).toBeLessThan(0.01)
})

test('changing exaggeration with no flight keeps the aim on the same ground', async ({ page }) => {
  await page.goto('/#/monitor')
  const camera = page.getByRole('group', { name: 'Camera view' })
  await expect(camera).toBeVisible({ timeout: 60_000 })
  const slider = page
    .getByRole('navigation', { name: 'Map', exact: true })
    .getByLabel('Vertical exaggeration')
  await camera.getByRole('button', { name: 'Pit' }).click()
  await settledShot(page)

  // At rest, a change rescales the aim point as before: the Pit view at 3x.
  await slider.press('End')
  await expect(slider).toHaveValue('3')
  const changedAtRest = await settledShot(page)
  await camera.getByRole('button', { name: 'Oblique' }).click()
  await settledShot(page)
  await camera.getByRole('button', { name: 'Pit' }).click()
  const reference = await settledShot(page)
  expect(await differingShare(page, changedAtRest, reference)).toBeLessThan(0.01)
})

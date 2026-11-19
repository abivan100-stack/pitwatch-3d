import { expect, test, type Page } from '@playwright/test'

// The 3D model used to be a tile floating on the page: the surveyed block ended in a cut and
// nothing lay beyond it. It now sits in decorative natural ground (the apron) that fades into the
// page, with a hairline where the surveyed area ends. The apron is scenery, never surveyed: a click
// on it must not read the ground behind it, and the Inspector must report it as outside the survey.

test.use({ reducedMotion: 'reduce' })
test.describe.configure({ timeout: 180_000 })

/**
 * Share of a canvas region the scene leaves empty. Everything but the canvas is hidden over a
 * white page, so a pixel that is still white is one the scene drew nothing on (the canvas is
 * transparent: ground, apron and its fade all come out darker than 250). `region` is fractions of
 * the canvas: [x0, x1, y0, y1].
 */
async function emptyShare(page: Page, canvas: string, region: [number, number, number, number]) {
  const style = await page.addStyleTag({
    content: `* { visibility: hidden !important; } html, body { background: #fff !important; } canvas { visibility: visible !important; }`,
  })
  try {
    // The demand-driven map canvas keeps its last frame; the landing canvas redraws on its own.
    await page.waitForTimeout(800)
    const shot = (await page.locator(canvas).screenshot()).toString('base64')
    return await page.evaluate(
      async ([b64, [x0, x1, y0, y1]]) => {
        const bytes = Uint8Array.from(atob(b64 as string), (ch) => ch.charCodeAt(0))
        const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const cv = new OffscreenCanvas(img.width, img.height)
        const cx = cv.getContext('2d')!
        cx.drawImage(img, 0, 0)
        const d = cx.getImageData(0, 0, img.width, img.height).data
        let empty = 0
        let n = 0
        for (let y = Math.floor(y0 * img.height); y < Math.floor(y1 * img.height); y++) {
          for (let x = Math.floor(x0 * img.width); x < Math.floor(x1 * img.width); x++) {
            const p = (y * img.width + x) * 4
            n++
            if (d[p] >= 250 && d[p + 1] >= 250 && d[p + 2] >= 250) empty++
          }
        }
        return empty / n
      },
      [shot, region] as const,
    )
  } finally {
    await style.evaluate((el) => (el as Element).remove())
  }
}

/** Waits for the canvas to exist and to have left its 300 x 150 default size. */
async function canvasReady(page: Page, selector: string) {
  const canvas = page.locator(selector)
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(300)
  await page.waitForTimeout(2500)
  return canvas
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the landing model leaves no empty ground below its far edge at ${viewport.width} px, at every angle`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/#/')
    const canvas = await canvasReady(page, '.hero-stage canvas')
    const box = (await canvas.boundingBox())!

    // The default view, then a drag that turns the model by about 60 degrees. The top
    // of the view is the far ground fading into the page, which is meant; below it the model's
    // ground has to run to the left, right and bottom of the picture.
    for (let turn = 0; turn < 2; turn++) {
      if (turn > 0) {
        const y = box.y + box.height * 0.6
        await page.mouse.move(box.x + box.width * 0.3, y)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * 0.3 + 150, y, { steps: 8 })
        await page.mouse.up()
        await page.waitForTimeout(1500)
      }
      const empty = await emptyShare(page, '.hero-stage canvas', [0.02, 0.98, 0.35, 0.98])
      expect(empty, `empty share of the lower picture after ${turn} turns`).toBeLessThan(0.01)
    }
  })
}

test('the 3D map at the Oblique preset leaves no empty ground anywhere in the picture', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/monitor')
  const camera = page.getByRole('group', { name: 'Camera view' })
  await expect(camera).toBeVisible({ timeout: 60_000 })
  await camera.getByRole('button', { name: 'Oblique', exact: true }).click()
  await canvasReady(page, '.scene-wrap canvas')
  const empty = await emptyShare(page, '.scene-wrap canvas', [0, 1, 0.1, 1])
  expect(empty).toBeLessThan(0.01)
})

test('the key says where the surveyed area ends', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/monitor')
  const key = page.getByRole('region', { name: 'Map key' })
  await expect(key.getByText('Surveyed area (simulated)', { exact: true })).toBeVisible({
    timeout: 60_000,
  })
})

test('a click or a typed point on the apron is read as outside the survey', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/monitor')
  const camera = page.getByRole('group', { name: 'Camera view' })
  await expect(camera).toBeVisible({ timeout: 60_000 })
  // No badge to win a click, and both side cards folded away: the Top view then shows the block
  // in the middle with the apron either side of it.
  await page.getByRole('switch', { name: 'Findings' }).click()
  await page.keyboard.press('[')
  await page.keyboard.press(']')
  await camera.getByRole('button', { name: 'Top', exact: true }).click()
  await canvasReady(page, '.scene-wrap canvas')
  const inspector = page.locator('#details-tabpanel')
  const showInspector = async () => {
    await page.keyboard.press(']')
    await page.getByRole('tab', { name: 'Inspector' }).click()
  }

  // The control: a click on the surveyed ground reads it.
  await page.mouse.click(720, 450)
  await showInspector()
  await expect(inspector.getByText('Selected point')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(inspector.getByText('Nothing selected')).toBeVisible()
  await page.keyboard.press(']')
  await expect(inspector).toBeHidden()

  // The apron lies either side of the block at the Top preset. A click there picks a point west
  // (or east) of the grid, and the Inspector says it has no reading there.
  const east = page.getByLabel('East', { exact: true })
  for (const [x, outside] of [
    [100, (v: number) => v < 0],
    [1340, (v: number) => v > 2048],
  ] as const) {
    await page.mouse.click(x, 450)
    await showInspector()
    await expect(inspector.getByText('Selected point')).toBeVisible()
    expect(outside(Number(await east.inputValue()))).toBe(true)
    await expect(
      page.getByText('No reading here: the point is outside the survey grid.'),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press(']')
    await expect(inspector).toBeHidden()
  }
  await showInspector()

  // A typed point on the apron is read as outside the surveyed grid, in today's words.
  await east.fill('-1500')
  await page.getByLabel('North', { exact: true }).fill('1000')
  await page.getByRole('button', { name: 'Read point' }).click()
  await expect(page.locator('form').getByRole('status')).toContainText(
    'E -1,500 m, N 1,000 m is outside the survey grid (E 0–2,048 m, N 0–2,048 m). The position is reported; elevations cannot be.',
  )
  await expect(
    page.getByText('No reading here: the point is outside the survey grid.'),
  ).toBeVisible()
})

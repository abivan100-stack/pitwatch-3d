import { expect, test, type Page } from '@playwright/test'

// Only what is drawn can be clicked (#55). Two separate failures used to break that:
// - with Terrain switched off, the hidden surface kept its click handler, and neither R3F nor
//   three skips invisible objects, so clicks still read and measured ground that was not drawn;
// - finding badges ignore depth and show through pit walls, but the wall in front took the
//   click and stopped it, so a badge the visitor could see could not be clicked.

test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } })
// Software WebGL is slow to screenshot; each test waits for the canvas to settle several times.
test.describe.configure({ timeout: 180_000 })

async function openMonitor(page: Page) {
  await page.goto('/#/monitor')
  await expect(page.getByRole('group', { name: 'Camera view' })).toBeVisible({ timeout: 60_000 })
}

/** The middle of the stage: the area the side cards leave free, with no HUD control on it. */
async function stageCentre(page: Page) {
  const box = (await page.locator('.stage').boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Waits until the demand-driven canvas stops changing, then returns its pixels as base64 PNG. */
async function settledShot(page: Page) {
  const canvas = page.locator('.scene-wrap canvas')
  let last = ''
  for (let i = 0; i < 20; i++) {
    const shot = (await canvas.screenshot()).toString('base64')
    if (shot === last) return shot
    last = shot
    await page.waitForTimeout(250)
  }
  return last
}

async function preset(page: Page, name: string) {
  await page.getByRole('group', { name: 'Camera view' }).getByRole('button', { name }).click()
}

const inspector = (page: Page) => page.locator('#details-tabpanel')

test('a hidden terrain takes no clicks, a shown one reads a click but not a drag', async ({
  page,
}) => {
  await openMonitor(page)
  // Findings off, so no badge sits under the pointer: this test is about the ground alone.
  const findings = page.getByRole('switch', { name: 'Findings' })
  await findings.click()
  await expect(findings).toHaveAttribute('aria-checked', 'false')
  await preset(page, 'Top')
  await settledShot(page)
  const c = await stageCentre(page)

  // Terrain on: a drag is a camera move, not a pick; a click reads the point.
  await page.mouse.move(c.x, c.y)
  await page.mouse.down()
  await page.mouse.move(c.x + 60, c.y + 40, { steps: 6 })
  await page.mouse.up()
  await page.getByRole('tab', { name: 'Inspector' }).click()
  await expect(inspector(page).getByText('Nothing selected')).toBeVisible()
  await preset(page, 'Top')
  await settledShot(page)
  await page.mouse.click(c.x, c.y)
  await expect(inspector(page).getByText('Selected point')).toBeVisible()

  // Clear the pick, then switch Terrain off: the same click must find nothing.
  await page.keyboard.press('Escape')
  await expect(inspector(page).getByText('Nothing selected')).toBeVisible()
  const terrain = page.getByRole('switch', { name: 'Terrain' })
  await terrain.click()
  await expect(terrain).toHaveAttribute('aria-checked', 'false')
  await settledShot(page)
  await page.mouse.click(c.x, c.y)

  // Measure mode too: two clicks where the model was set neither A nor B.
  await page.keyboard.press('m')
  await page.mouse.click(c.x, c.y)
  await page.mouse.click(c.x + 80, c.y + 30)
  await page.getByRole('tab', { name: 'Inspector' }).click()
  await expect(inspector(page).getByText('Nothing selected')).toBeVisible()
  await expect(inspector(page).getByText('Selected point')).toHaveCount(0)
  await expect(inspector(page).getByText('Measurement', { exact: true })).toHaveCount(0)
})

/**
 * Screen centres of the finding badges. The badges are the near-white pixels that appear when
 * the Findings layer goes on; the layer also tints finding cells, but never white, and the white
 * lease line is drawn in both shots. Returns one point per badge, in page coordinates.
 */
async function badgeCentres(page: Page): Promise<{ x: number; y: number }[]> {
  const findings = page.getByRole('switch', { name: 'Findings' })
  await expect(findings).toHaveAttribute('aria-checked', 'true')
  const on = await settledShot(page)
  await findings.click()
  await expect(findings).toHaveAttribute('aria-checked', 'false')
  const off = await settledShot(page)
  await findings.click()
  await expect(findings).toHaveAttribute('aria-checked', 'true')
  await settledShot(page)

  const box = (await page.locator('.scene-wrap canvas').boundingBox())!
  const blobs = await page.evaluate(
    async ([a, b]) => {
      const read = async (b64: string) => {
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))
        const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const cv = new OffscreenCanvas(img.width, img.height)
        const cx = cv.getContext('2d')!
        cx.drawImage(img, 0, 0)
        return cx.getImageData(0, 0, img.width, img.height)
      }
      const [on, off] = [await read(a), await read(b)]
      const { width: w, height: h } = on
      const mask = new Uint8Array(w * h)
      for (let i = 0; i < w * h; i++) {
        const p = i * 4
        const white = on.data[p] > 238 && on.data[p + 1] > 238 && on.data[p + 2] > 232
        const diff =
          Math.abs(on.data[p] - off.data[p]) +
          Math.abs(on.data[p + 1] - off.data[p + 1]) +
          Math.abs(on.data[p + 2] - off.data[p + 2])
        if (white && diff > 12) mask[i] = 1
      }
      // 4-connected components; a badge fill is a solid pill tens of pixels wide.
      const seen = new Uint8Array(w * h)
      const out: { x: number; y: number; n: number; w: number; h: number }[] = []
      for (let s = 0; s < w * h; s++) {
        if (!mask[s] || seen[s]) continue
        const stack = [s]
        seen[s] = 1
        let [n, sx, sy, x0, x1, y0, y1] = [0, 0, 0, w, 0, h, 0]
        while (stack.length) {
          const i = stack.pop()!
          const x = i % w
          const y = (i - x) / w
          n++
          sx += x
          sy += y
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
          y0 = Math.min(y0, y)
          y1 = Math.max(y1, y)
          for (const j of [i - 1, i + 1, i - w, i + w]) {
            if (j < 0 || j >= w * h || seen[j] || !mask[j]) continue
            if (Math.abs((j % w) - x) > 1) continue
            seen[j] = 1
            stack.push(j)
          }
        }
        out.push({ x: sx / n, y: sy / n, n, w: x1 - x0 + 1, h: y1 - y0 + 1 })
      }
      return { out, w, h }
    },
    [on, off] as const,
  )
  // Screenshots are in device pixels; the badge is about 76 x 28 CSS px, mostly white fill.
  const scale = blobs.w / box.width
  const points = blobs.out
    .filter((b) => {
      const [bw, bh] = [b.w / scale, b.h / scale]
      return bw > 50 && bw < 110 && bh > 16 && bh < 42 && b.n / scale ** 2 > 0.4 * bw * bh
    })
    .map((b) => ({ x: box.x + b.x / scale, y: box.y + b.y / scale }))
  // A badge under a side card is drawn but covered; keep the ones the visitor can reach.
  const onCanvas = await page.evaluate(
    (ps) => ps.map((p) => document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS'),
    points,
  )
  return points.filter((_, i) => onCanvas[i])
}

test('a badge drawn through the pit wall wins the click over the wall', async ({ page }) => {
  await openMonitor(page)
  // At 3x the pit is deep enough that, from the Pit preset, the near wall stands between the
  // camera and R2-1's badge over the sump. The badge still shows (it skips the depth test);
  // before #55 the wall took this click and the Inspector read a point on the wall.
  const slider = page
    .getByRole('navigation', { name: 'Map', exact: true })
    .getByLabel('Vertical exaggeration')
  await slider.focus()
  await page.keyboard.press('End')
  await expect(slider).toHaveValue('3')
  await preset(page, 'Pit')
  const badges = await badgeCentres(page)
  expect(badges).toHaveLength(1)

  // Guard: the terrain really is under that pixel, so the click below is a real contest
  // between wall and badge. With Findings off, the same click reads the ground.
  const findings = page.getByRole('switch', { name: 'Findings' })
  await findings.click()
  await expect(findings).toHaveAttribute('aria-checked', 'false')
  await settledShot(page)
  await page.mouse.click(badges[0].x, badges[0].y)
  await expect(inspector(page).getByText('Selected point')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(inspector(page).getByText('Nothing selected')).toBeVisible()
  await findings.click()
  await expect(findings).toHaveAttribute('aria-checked', 'true')

  await preset(page, 'Pit')
  await settledShot(page)
  await page.mouse.click(badges[0].x, badges[0].y)
  // The click selects the finding (the address follows it) instead of reading the ground.
  await expect(page).toHaveURL(/#\/monitor\?finding=R2-1$/)
  await expect(page.getByRole('tab', { name: 'Findings' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Inspector' }).click()
  await expect(inspector(page).getByText('Nothing selected')).toBeVisible()
})

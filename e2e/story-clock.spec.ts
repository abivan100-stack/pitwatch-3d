import { expect, test } from '@playwright/test'

// Between Baseline and Current the landing model is a blend of the two surveys, not a survey,
// so the date bar must not name a date and day for it (#59).

/** Runs page time (performance.now and animation-frame timestamps) at an adjustable rate. */
function slowableClock() {
  const real = performance.now.bind(performance)
  let at = real()
  let base = at
  let rate = 1
  const now = () => base + (real() - at) * rate
  const w = window as unknown as { __timeRate: (r: number) => void }
  w.__timeRate = (r: number) => {
    base = now()
    at = real()
    rate = r
  }
  performance.now = now
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (cb) => raf(() => cb(now()))
}

test('the date bar calls the in-between model an illustration', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(slowableClock)
  await page.goto('/#/')
  const views = page.getByRole('group', { name: 'What the model shows' })
  const readout = page.locator('.story-clock .cond')
  // The landing page opens on Findings, at the current survey.
  await expect(readout).toHaveText('22 Aug 2026, day 281 of 281', { timeout: 60_000 })

  // Record every readout while the model goes back to the baseline. At 1/20 speed the 900 ms
  // tween takes about 18 s, so it has many in-between frames even under software WebGL.
  await readout.evaluate((el) => {
    const seen = new Set<string>([el.textContent ?? ''])
    new MutationObserver(() => seen.add(el.textContent ?? '')).observe(el, {
      characterData: true,
      childList: true,
      subtree: true,
    })
    ;(window as unknown as { __seen: Set<string> }).__seen = seen
  })
  await page.evaluate(() =>
    (window as unknown as { __timeRate: (r: number) => void }).__timeRate(0.05),
  )
  await views.getByRole('button', { name: 'Baseline' }).click()
  await expect(readout).toHaveText('Illustration between surveys', { timeout: 20_000 })
  await page.evaluate(() =>
    (window as unknown as { __timeRate: (r: number) => void }).__timeRate(1),
  )
  await expect(readout).toHaveText('281 days between surveys')

  // Only the two survey readouts and the illustration ever showed; no dated day in between.
  const seen = await page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen])
  expect(seen.sort()).toEqual(
    [
      '22 Aug 2026, day 281 of 281',
      '281 days between surveys',
      'Illustration between surveys',
    ].sort(),
  )
})

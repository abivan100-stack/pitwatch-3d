import { expect, test } from '@playwright/test'

// Between Baseline and Current the landing model is a blend of the two surveys, not a survey,
// so the sentence under it must not name a survey or a date for it (#59). The date bar is gone
// (#72); the before/after slider and its status sentence carry the same honesty.

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

test('the sentence under the model calls the in-between model an illustration', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.addInitScript(slowableClock)
  await page.goto('/#/')
  const views = page.getByRole('group', { name: 'What the model shows' })
  const readout = views.locator('.model-status')
  // The landing page opens on the current survey, with the findings; switch them off so the
  // sentence is only about which survey the model is.
  await expect(readout).toContainText('Current survey, 22 Aug 2026', { timeout: 60_000 })
  await views.getByRole('switch', { name: 'Show permit findings' }).click()
  await expect(readout).toHaveText('Current survey, 22 Aug 2026.')

  // Record every sentence while the model goes back to the baseline. At 1/20 speed the 900 ms
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
  await views.getByRole('button', { name: /^Baseline/ }).click()
  await expect(readout).toHaveText('An illustration between the two surveys, not a survey.', {
    timeout: 20_000,
  })
  await page.evaluate(() =>
    (window as unknown as { __timeRate: (r: number) => void }).__timeRate(1),
  )
  await expect(readout).toHaveText('Baseline survey, 14 Nov 2025.')

  // Only the two surveys and the illustration were ever named; no survey date in between.
  const seen = await page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen])
  expect(seen.sort()).toEqual(
    [
      'Current survey, 22 Aug 2026.',
      'An illustration between the two surveys, not a survey.',
      'Baseline survey, 14 Nov 2025.',
    ].sort(),
  )
})

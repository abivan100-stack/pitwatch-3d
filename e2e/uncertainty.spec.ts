import { expect, test, type Page } from '@playwright/test'

// The calculator used to teach one line — the noise band kσ — while the engine reports a change
// only beyond minChange + kσ. The 0.40 m example was therefore called a real change when it is
// not reportable under R1 or R3. These checks pin the two thresholds apart, pin the plain-language
// layout of the page (fixed 0 to 12 m number line, one place per figure, selected preset, a
// verdict announced only when its category changes), and pin the wording of the simulated
// scenario on the pages that used to claim a real breach.

const calculator = (page: Page) => page.locator('section[aria-labelledby="noise-title"]')

/** A labelled flag on the number line, e.g. "Noise limit 0.14 m". */
const flag = (page: Page, name: string) =>
  calculator(page).locator('.noise-flag').filter({ hasText: name })

/** The one-line category, the only live region, and the sentence that carries the figures. */
const category = (page: Page) => calculator(page).getByRole('status')
const sentence = (page: Page) => calculator(page).locator('[role="status"] + p')

const preset = (page: Page, name: string | RegExp) =>
  calculator(page).getByRole('group', { name: 'Example surveys' }).getByRole('button', { name })

test('the noise limit and the reporting threshold are labelled once, on the number line', async ({
  page,
}) => {
  await page.goto('/#/uncertainty')
  const calc = calculator(page)
  await expect(calc.getByRole('heading', { name: 'When is a change reportable?' })).toBeVisible()

  // Default preset: σ1 = σ2 = 0.05 m, so the noise limit is 0.14 m and the threshold 0.64 m.
  await expect(flag(page, 'Noise limit')).toContainText('0.14 m')
  await expect(flag(page, 'Reporting threshold')).toContainText('0.64 m')
  await expect(flag(page, 'Your change')).toContainText('0.40 m')

  // The three figure boxes are gone, and so is the caption that repeated the formula.
  await expect(calc.locator('dl')).toHaveCount(0)
  await expect(calc.locator('figcaption')).not.toContainText('0.64 m')
  await expect(calc.locator('figcaption')).not.toContainText('0.14 m')
  // The combined wobble is stated once, in the line's own key, in ordinary words.
  await expect(calc.locator('figcaption')).toContainText('combined wobble, σ = 0.07 m')

  // Plain words come first.
  await expect(calc).toContainText(
    'A change is reported only if it is bigger than the surveys’ own wobble, and bigger than a minimum on top of that.',
  )

  // 0.40 m clears the noise but not the reporting threshold, and the page says exactly that.
  await expect(category(page)).toHaveText('Distinguishable from the noise, not reportable.')
  await expect(sentence(page)).toContainText('0.40 m')
  await expect(sentence(page)).toContainText('0.64 m')
})

test('the depth rule is a closed disclosure with the plain answer inside', async ({ page }) => {
  await page.goto('/#/uncertainty')
  const calc = calculator(page)
  const note = calc.locator('details')
  await expect(note).toHaveCount(1)
  await expect(note.locator('summary')).toHaveText('Does the depth rule use this?')
  expect(await note.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false)
  await expect(note.locator('p')).toBeHidden()

  await note.locator('summary').click()
  await expect(note.locator('p')).toBeVisible()
  // R2 is explained separately: no minimum-change allowance, current survey's σ alone.
  await expect(note).toContainText('compares the ground with the approved pit floor')
  await expect(note).toContainText('no minimum-change allowance')
  await expect(note).toContainText('2σ2 = 0.10 m')
})

test('the number line stays 0 to 12 m while the sliders and presets move', async ({ page }) => {
  await page.goto('/#/uncertainty')
  const calc = calculator(page)
  const ticks = calc.locator('.noise-ticks span')
  const line = calc.locator('.noise-line')
  const marker = calc.locator('.noise-marker')

  const expectedTicks = ['0 m', '3 m', '6 m', '9 m', '12 m']
  const stateAt = async (change: number) => {
    // The marker's centre sits at change / 12 of the line, whatever else is set.
    await expect
      .poll(async () => {
        const l = await line.boundingBox()
        const k = await marker.boundingBox()
        if (!l || !k) return Number.NaN
        return Math.round(((k.x + k.width / 2 - l.x) / l.width) * 12 * 10) / 10
      })
      .toBeCloseTo(change, 1)
  }

  await expect(ticks).toHaveText(expectedTicks)
  await stateAt(0.4)

  await preset(page, 'Global elevation model').click()
  await expect(ticks).toHaveText(expectedTicks)
  await stateAt(6)

  await calc.getByLabel('Baseline survey wobble (σ1)').fill('0')
  await calc.getByLabel('Current survey wobble (σ2)').fill('0')
  await expect(ticks).toHaveText(expectedTicks)
  await stateAt(6)

  await calc.getByLabel('Measured change in ground height').fill('12')
  await expect(ticks).toHaveText(expectedTicks)
  await stateAt(12)

  await preset(page, 'Drone survey with ground control').click()
  await expect(ticks).toHaveText(expectedTicks)
  await stateAt(0.4)
})

test('the verdict is announced when its category changes, not on every step', async ({ page }) => {
  await page.goto('/#/uncertainty')
  const calc = calculator(page)
  await expect(calc.getByRole('status')).toHaveCount(1)

  // Count every DOM change inside the live region.
  await calc.getByRole('status').evaluate((el) => {
    const w = window as unknown as { __statusChanges: number }
    w.__statusChanges = 0
    new MutationObserver((records) => (w.__statusChanges += records.length)).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    })
  })
  const changes = () =>
    page.evaluate(() => (window as unknown as { __statusChanges: number }).__statusChanges)

  const change = calc.getByLabel('Measured change in ground height')
  await change.focus()
  // 0.4 -> 0.5 -> 0.6 stays "distinguishable, not reportable" (threshold 0.64 m): the sentence
  // updates with the figure, the live region does not move.
  await change.press('ArrowRight')
  await expect(sentence(page)).toContainText('0.50 m')
  await change.press('ArrowRight')
  await expect(sentence(page)).toContainText('0.60 m')
  expect(await changes()).toBe(0)
  await expect(category(page)).toHaveText('Distinguishable from the noise, not reportable.')

  // 0.7 m clears 0.64 m: the category changes, and so does the live region.
  await change.press('ArrowRight')
  await expect(category(page)).toHaveText('Reportable under R1 and R3.')
  expect(await changes()).toBeGreaterThan(0)
})

test('the presets are a selected-state control and the sliders keep their step', async ({
  page,
}) => {
  await page.goto('/#/uncertainty')
  const calc = calculator(page)
  const drone = preset(page, /Drone survey with ground control/)
  const global = preset(page, /Global elevation model/)

  await expect(drone).toHaveAttribute('aria-pressed', 'true')
  await expect(global).toHaveAttribute('aria-pressed', 'false')
  await global.click()
  await expect(global).toHaveAttribute('aria-pressed', 'true')
  await expect(drone).toHaveAttribute('aria-pressed', 'false')
  // The preset says what it sets, and the change slider says its value is an example.
  await expect(global).toContainText('4.00 m wobble')
  await expect(global).toContainText('example change to 6.0 m')
  await expect(calc).toContainText('The presets set an example change.')

  // Moving a survey slider away from a preset deselects it.
  await calc.getByLabel('Baseline survey wobble (σ1)').fill('1')
  await expect(global).toHaveAttribute('aria-pressed', 'false')
  await expect(drone).toHaveAttribute('aria-pressed', 'false')

  // The keyboard arrow moves by the slider step: 0.05 m for a wobble, 0.1 m for the change.
  const s1 = calc.getByLabel('Baseline survey wobble (σ1)')
  const c = calc.getByLabel('Measured change in ground height')
  await expect(s1).toHaveAttribute('step', '0.05')
  await expect(calc.getByLabel('Current survey wobble (σ2)')).toHaveAttribute('step', '0.05')
  await expect(c).toHaveAttribute('step', '0.1')
  await s1.fill('0')
  await s1.press('ArrowRight')
  await expect(calc.locator('.noise-value').nth(0)).toHaveText('0.05 m')
  await c.fill('0')
  await c.press('ArrowRight')
  await expect(calc.locator('.noise-value').nth(2)).toHaveText('0.10 m')

  // Each slider says in one line what it is.
  await expect(calc).toContainText('How much the survey itself can move a height.')
})

test('printed comparisons preserve the order at both boundaries', async ({ page }) => {
  await page.goto('/#/uncertainty')
  const calc = calculator(page)
  const change = calc.getByLabel('Measured change in ground height')
  const baseline = calc.getByLabel('Baseline survey wobble (σ1)')
  const current = calc.getByLabel('Current survey wobble (σ2)')

  await preset(page, 'Global elevation model').click()
  // σ1 = σ2 = 4 m: noise limit 11.31 m, threshold 11.81 m, and the 6 m change is inside.
  await expect(flag(page, 'Noise limit')).toContainText('11.31 m')
  await expect(flag(page, 'Reporting threshold')).toContainText('11.81 m')
  await expect(category(page)).toHaveText('Could be survey noise.')
  await expect(sentence(page)).toContainText('6.00 m is within the ±11.31 m noise limit')

  await change.fill('11.4')
  await expect(sentence(page)).toContainText('11.40 m is larger than the ±11.31 m')
  await change.fill('11.8')
  await expect(sentence(page)).toContainText('11.80 m is larger than the ±11.31 m')
  await expect(sentence(page)).toContainText('below the 11.81 m reporting threshold')

  // 12 m clears 11.81 m, so the verdict and its numbers move with the slider.
  await change.fill('12')
  await expect(category(page)).toHaveText('Reportable under R1 and R3.')
  await expect(sentence(page)).toContainText('12.00 m clears the 11.81 m reporting threshold')

  // A reachable gap smaller than 0.001 m: both would round to 11.90 m at two decimals.
  await baseline.fill('3.95')
  await current.fill('4.45')
  await change.fill('11.9')
  await expect(sentence(page)).toContainText('11.9000 m is within the ±11.9004 m noise limit')
  await expect(flag(page, 'Noise limit')).toContainText('11.9004 m')

  // Binary arithmetic yields 1.2999999999999998 m for the exact 1.3 m limit.
  await baseline.fill('0.25')
  await current.fill('0.6')
  await change.fill('1.3')
  await expect(sentence(page)).toContainText('1.30 m is within the ±1.30 m noise limit')
  await change.fill('1.8')
  await expect(category(page)).toHaveText('Distinguishable from the noise, not reportable.')
  await expect(sentence(page)).toContainText('at the 1.80 m reporting threshold')
})

test('the two columns end at about the same height on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/#/uncertainty')
  const calc = calculator(page)
  // Measure where the content ends, not the boxes: the last thing in each column.
  const left = await calc.getByTestId('noise-left').boundingBox()
  const leftEnd = await calc.locator('details').boundingBox()
  const right = await calc.getByTestId('noise-controls').boundingBox()
  const rightEnd = await calc.getByLabel('Measured change in ground height').boundingBox()
  const a = leftEnd!.y + leftEnd!.height - left!.y
  const b = rightEnd!.y + rightEnd!.height - right!.y
  expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.1)
  // And they start together: the copy is not pushed down the page.
  expect(Math.abs(left!.y - right!.y)).toBeLessThan(4)
})

for (const width of [1440, 1100, 800, 390]) {
  test(`the page reads at ${width} px: text at least 13 px, nothing overflows`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#/uncertainty')
    await expect(calculator(page)).toBeVisible()

    // Put the line in its two extremes: flags must stay inside the chart at both.
    const change = calculator(page).getByLabel('Measured change in ground height')
    for (const value of ['12', '0', '0.4']) {
      await change.fill(value)
      // The flags slide as they animate, so the check is made once they have settled.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const chart = document.querySelector('.noise-chart')!.getBoundingClientRect()
            return [...document.querySelectorAll('.noise-flag')].every((f) => {
              const r = f.getBoundingClientRect()
              return r.left >= chart.left - 1 && r.right <= chart.right + 1
            })
          }),
        )
        .toBe(true)
    }

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    const small = await page.evaluate(() => {
      const roots = [
        document.querySelector('section[aria-labelledby="noise-title"]')!,
        document.querySelector('section[aria-labelledby="resolution-title"]')!,
      ]
      const bad: string[] = []
      for (const root of roots) {
        for (const el of root.querySelectorAll('*')) {
          const own = [...el.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
          )
          if (own && parseFloat(getComputedStyle(el).fontSize) < 13) {
            bad.push(`${el.tagName}.${el.className}: ${el.textContent!.trim().slice(0, 30)}`)
          }
        }
      }
      return bad
    })
    expect(small).toEqual([])
  })
}

test('the resolution section aligns its heading, keys the lines and labels the axes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/uncertainty')
  const section = page.locator('section[aria-labelledby="resolution-title"]')
  const heading = section.getByRole('heading', { name: 'Why survey resolution matters' })
  const intro = heading.locator('xpath=following-sibling::p')

  // Top-aligned, not baseline-aligned: both boxes begin on the same line.
  const h = await heading.boundingBox()
  const p = await intro.boundingBox()
  expect(Math.abs(h!.y - p!.y)).toBeLessThan(2)
  // One sentence.
  const text = (await intro.textContent())!.trim()
  expect(text.match(/[.!?](\s|$)/g)).toHaveLength(1)

  // The key comes before the first illustration.
  const key = section.getByTestId('res-key')
  await expect(key).toContainText('Faint: the real ground')
  await expect(key).toContainText('Bold: what each survey records')
  const k = await key.boundingBox()
  const first = await section.locator('.res-panel').first().boundingBox()
  expect(k!.y + k!.height).toBeLessThanOrEqual(first!.y)

  // Each illustration names both of its axes.
  await expect(section.getByText('↑ Height')).toHaveCount(3)
  await expect(section.getByText('Distance across the pit →')).toHaveCount(3)
  // The old caption under the figures is gone.
  await expect(section).not.toContainText('Illustration: a cross-section')
})

test('no page claims a real permit was broken', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('See where a simulated mine')
  // Pins cover findings from all three rules, including warnings, rather than lease breaches alone.
  const findingsCaption = page.locator('.hero-controls')
  await expect(findingsCaption).toContainText(
    'Each pin marks a simulated finding under one of the permit rules',
  )
  await expect(findingsCaption).not.toContainText('breaking the lease')

  await page.goto('/#/findings')
  const findings = page.locator('main')
  // The page waits for the surveys, which take longer under a full parallel run.
  await expect(findings).toContainText("the demo engine's classifications of a simulated change", {
    timeout: 60_000,
  })
  await expect(findings).toContainText('not a legal determination')

  await page.goto('/#/rules')
  const tests = page.locator('.permit-test code')
  await expect(tests).toHaveCount(3)
  await expect(tests.nth(0)).toContainText('0.5 m + 2σ')
  await expect(tests.nth(1)).toContainText('2σ2')
  await expect(tests.nth(1)).toContainText('no minimum change')
  await expect(tests.nth(2)).toContainText('0.5 m + 2σ')
  await expect(page.locator('main')).toContainText(
    'R2 measures the ground against a fixed approved floor',
  )

  await page.goto('/#/about')
  await expect(page.locator('main')).toContainText('violation and warning are its labels')
})

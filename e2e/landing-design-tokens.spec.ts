import { expect, test } from '@playwright/test'

test('landing decorations follow the theme colour tokens', async ({ page }) => {
  await page.goto('/')

  const before = await page.evaluate(() => ({
    barStripe: getComputedStyle(document.querySelector('.landing-bar')!, '::after').backgroundImage,
    footerStripe: getComputedStyle(document.querySelector('.landing-close')!, '::before')
      .backgroundImage,
    modelShadow: getComputedStyle(document.querySelector('.hero-stage')!).boxShadow,
    provenanceBorder: getComputedStyle(document.querySelector('.chip-dark')!).borderColor,
  }))

  const after = await page.evaluate(() => {
    document.documentElement.style.setProperty('--color-ink', 'rgb(255 0 255)')
    document.documentElement.style.setProperty('--color-bg', 'rgb(0 255 255)')
    document.documentElement.style.setProperty('--color-side-ink', 'rgb(12 34 56)')

    return {
      barStripe: getComputedStyle(document.querySelector('.landing-bar')!, '::after')
        .backgroundImage,
      footerStripe: getComputedStyle(document.querySelector('.landing-close')!, '::before')
        .backgroundImage,
      modelShadow: getComputedStyle(document.querySelector('.hero-stage')!).boxShadow,
      provenanceBorder: getComputedStyle(document.querySelector('.chip-dark')!).borderColor,
    }
  })

  expect(after.barStripe).not.toBe(before.barStripe)
  expect(after.footerStripe).not.toBe(before.footerStripe)
  expect(after.modelShadow).not.toBe(before.modelShadow)
  expect(after.provenanceBorder).not.toBe(before.provenanceBorder)
})

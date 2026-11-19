import { expect, test } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

test('a shared link opens the map on that finding, and the address follows the selection', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/monitor?ref=x?finding=R1-1')

  const selected = page.locator('#details-tabpanel li.finding[data-selected]')
  await expect(selected).toContainText('R1-1', { timeout: 60_000 })
  await expect(page).toHaveURL(/#\/monitor\?ref=x\?finding=R1-1$/)

  // Choosing another finding moves the address with it, so what is on screen can be shared.
  await page
    .locator('#details-tabpanel li.finding')
    .filter({ hasText: 'R1-3' })
    .getByRole('button', { name: 'Show on map' })
    .click()
  await expect(selected).toContainText('R1-3')
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-3$/)
})

test('Show on map replaces the current map address instead of adding a history entry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.goto('/#/overview')
  const attention = page.locator('li.attention').filter({ hasText: 'R1-1' })
  await expect(attention).toBeVisible({ timeout: 60_000 })
  await attention.getByRole('button', { name: 'Show on map' }).click()
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-1$/)

  const selected = page.locator('#details-tabpanel li.finding[data-selected]')
  await expect(selected).toContainText('R1-1', { timeout: 60_000 })
  await page
    .locator('#details-tabpanel li.finding')
    .filter({ hasText: 'R1-2' })
    .getByRole('button', { name: 'Show on map' })
    .click()
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-2$/)
  await expect(selected).toContainText('R1-2')

  await page.goBack()
  await expect(page).toHaveURL(/#\/overview$/)
  await page.goForward()
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-2$/)
  await expect(selected).toContainText('R1-2', { timeout: 60_000 })
})

test('the selection follows existing map addresses through Back and Forward', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/monitor?finding=R1-1')

  const selected = page.locator('#details-tabpanel li.finding[data-selected]')
  await expect(selected).toContainText('R1-1', { timeout: 60_000 })
  await page.evaluate(() => {
    window.location.hash = '#/monitor?finding=R1-2'
  })
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-2$/)
  await expect(selected).toContainText('R1-2')

  await page.evaluate(() => {
    window.location.hash = '#/monitor'
  })
  await expect(page).toHaveURL(/#\/monitor$/)
  await expect(selected).toHaveCount(0)

  await page.goBack()
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-2$/)
  await expect(selected).toContainText('R1-2')
  await page.goBack()
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-1$/)
  await expect(selected).toContainText('R1-1')
  await page.goForward()
  await expect(page).toHaveURL(/#\/monitor\?finding=R1-2$/)
  await expect(selected).toContainText('R1-2')

  await page.evaluate(() => {
    window.location.hash = '#/monitor?finding=NOPE-9'
  })
  await expect(page).toHaveURL(/#\/monitor\?finding=NOPE-9$/)
  await expect(selected).toHaveCount(0)
})

test('an unknown finding in a link is ignored, and the map still opens', async ({ page }) => {
  await page.goto('/#/monitor?finding=NOPE-9')
  await expect(page.getByRole('group', { name: 'Camera view' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('#details-tabpanel li.finding[data-selected]')).toHaveCount(0)
})

test('Copy link on the findings page puts a working link on the clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/#/findings')
  const row = page.locator('li.frow').filter({ hasText: 'R1-1' })
  await expect(row).toBeVisible({ timeout: 60_000 })
  await row.getByRole('button', { name: 'Copy link' }).click()
  await expect(row.getByRole('button', { name: 'Link copied' })).toBeVisible()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toMatch(/#\/monitor\?finding=R1-1$/)
})

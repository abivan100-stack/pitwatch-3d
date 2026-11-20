import { expect, test } from '@playwright/test'

const FINDING_IDS = ['R1-1', 'R2-1', 'R1-2', 'R3-1', 'R1-3']
const VIEWPORTS = [390, 800, 1100, 1440]

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function boxesOverlap(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

test('the site plan is a labelled, data-backed vector map at supported widths', async ({
  page,
}) => {
  await page.setViewportSize({ width: VIEWPORTS[0]!, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/overview')

  const plan = page.getByRole('group', { name: /Plan of the mine from above/ })
  await expect(plan.getByRole('button')).toHaveCount(FINDING_IDS.length, { timeout: 60_000 })
  const hitSizes = new Map<string, Box[]>()

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    await expect(plan).toBeVisible()
    await expect(plan.locator('.plan-change')).toHaveCount(2)
    await expect(plan.locator('.plan-contour')).not.toHaveCount(0)
    expect(await plan.locator('.plan-contour').count()).toBeLessThanOrEqual(4)
    await expect(plan.locator('.plan-finding-area')).toHaveCount(FINDING_IDS.length)
    await expect(plan.locator('image')).toHaveCount(0)

    const labels = await plan.locator('.plan-pin-label').allTextContents()
    expect(labels.map((label) => label.trim()).sort()).toEqual([...FINDING_IDS].sort())
    const markerBoxes: Box[] = []
    for (const id of FINDING_IDS) {
      const area = plan.locator(`.plan-finding-area[data-finding="${id}"]`)
      await expect(area).toHaveAttribute('d', /.+/)
      // The outline is the plan's button; the badge beside it is the pointer target.
      await expect(plan.getByRole('button', { name: new RegExp(`^${id},`) })).toHaveCount(1)
      const button = plan.locator(`.plan-pin[data-finding="${id}"]`)
      await expect(button).toBeVisible()
      const hitBox = await button.locator('.plan-pin-hit').boundingBox()
      expect(hitBox, `${id} hit circle should have a box at ${width}px`).not.toBeNull()
      expect(hitBox!.width, `${id} hit width at ${width}px`).toBeGreaterThanOrEqual(44)
      expect(hitBox!.height, `${id} hit height at ${width}px`).toBeGreaterThanOrEqual(44)
      const sizes = hitSizes.get(id) ?? []
      sizes.push({ x: 0, y: 0, width: hitBox!.width, height: hitBox!.height })
      hitSizes.set(id, sizes)

      const displacement = await button.evaluate((group) => {
        const origin = group.parentElement?.querySelector('.plan-finding-origin')
        const disc = group.querySelector('.plan-pin-disc')
        if (!origin || !disc) return null
        const a = origin.getBoundingClientRect()
        const b = disc.getBoundingClientRect()
        return Math.hypot(
          a.x + a.width / 2 - (b.x + b.width / 2),
          a.y + a.height / 2 - (b.y + b.height / 2),
        )
      })
      expect(
        displacement,
        `${id} badge and origin should be measurable at ${width}px`,
      ).not.toBeNull()
      expect(
        displacement!,
        `${id} badge is drawn on its evidence at ${width}px (leaders may move it at most 108px)`,
      ).toBeLessThanOrEqual(110)

      // The badge and its id chip. (The button also holds the finding's outline, which may
      // legitimately overlap a neighbour's: R1-1 and R1-2 share ground at the east edge.)
      const chipBox = await button.locator('.plan-pin-label-bg').boundingBox()
      expect(chipBox, `${id} marker and ID should have a box at ${width}px`).not.toBeNull()
      const left = Math.min(hitBox!.x, chipBox!.x)
      const topEdge = Math.min(hitBox!.y, chipBox!.y)
      markerBoxes.push({
        x: left,
        y: topEdge,
        width: Math.max(hitBox!.x + hitBox!.width, chipBox!.x + chipBox!.width) - left,
        height: Math.max(hitBox!.y + hitBox!.height, chipBox!.y + chipBox!.height) - topEdge,
      })
    }
    for (let i = 0; i < markerBoxes.length; i++) {
      for (let j = i + 1; j < markerBoxes.length; j++) {
        expect(
          boxesOverlap(markerBoxes[i]!, markerBoxes[j]!),
          `${FINDING_IDS[i]} and ${FINDING_IDS[j]} marker/ID boxes overlap at ${width}px`,
        ).toBe(false)
      }
    }

    const title = page.locator('.plan-title-block')
    await expect(title).toContainText('Current survey')
    await expect(title).toContainText('2026')
    await expect(title.locator('.prov-derived')).toBeVisible()
    const footer = page.locator('.plan-footer')
    await expect(footer.locator('.plan-north-block')).toContainText('North')
    await expect(footer.locator('.plan-scale-block')).toContainText('500 m')

    const scaleRatio = await page.evaluate(() => {
      const svg = document.querySelector<SVGSVGElement>('svg.site-plan')
      const bar = document.querySelector<HTMLElement>('.plan-scale-track')
      if (!svg || !bar) return null
      return {
        ratio: bar.getBoundingClientRect().width / svg.clientWidth,
        viewBoxWidth: svg.viewBox.baseVal.width,
      }
    })
    expect(scaleRatio).not.toBeNull()
    expect(scaleRatio!.ratio).toBeCloseTo(500 / scaleRatio!.viewBoxWidth, 2)

    const hasRasterDataUrl = await plan.evaluate((svg) => /data:image\//i.test(svg.outerHTML))
    expect(hasRasterDataUrl).toBe(false)
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(hasHorizontalOverflow, `document overflows at ${width}px`).toBe(false)

    // One label for each of the four permitted zones, set beside the zone.
    const observedBoxes: Box[] = []
    const zoneLabels = await plan.locator('.plan-zone-label').all()
    expect(zoneLabels.length, `one label per permitted zone at ${width}px`).toBe(4)
    for (const label of zoneLabels) {
      await expect(label).toBeVisible()
      const labelBox = await label.boundingBox()
      expect(labelBox, `a zone label should have a box at ${width}px`).not.toBeNull()
      observedBoxes.push(labelBox!)
      for (const [index, markerBox] of markerBoxes.entries()) {
        expect(
          boxesOverlap(labelBox!, markerBox),
          `a zone label overlaps marker/ID ${FINDING_IDS[index]} at ${width}px: ${JSON.stringify({ labelBox, markerBox })}`,
        ).toBe(false)
      }
    }

    for (let i = 0; i < observedBoxes.length; i++) {
      for (let j = i + 1; j < observedBoxes.length; j++) {
        expect(
          boxesOverlap(observedBoxes[i]!, observedBoxes[j]!),
          `zone labels ${i} and ${j} overlap at ${width}px`,
        ).toBe(false)
      }
    }
    const leaseLabelBox = await plan.locator('.plan-lease-label').boundingBox()
    expect(leaseLabelBox, 'lease label should have a box').not.toBeNull()
    for (const [index, labelBox] of observedBoxes.entries()) {
      expect(
        boxesOverlap(labelBox, leaseLabelBox!),
        `zone label ${index} overlaps the lease label at ${width}px`,
      ).toBe(false)
    }

    // No label sits on a fill: probe the label's box from the page, so every point hit-tested
    // lists the shapes under it (the fills are painted shapes, so they take part).
    for (const label of zoneLabels) {
      await label.scrollIntoViewIfNeeded()
      const covered = await label.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit: string[] = []
        for (let i = 0; i <= 6; i++) {
          for (let j = 0; j <= 2; j++) {
            const x = r.left + (r.width * i) / 6
            const y = r.top + (r.height * (j + 0.5)) / 3
            for (const under of document.elementsFromPoint(x, y)) {
              if (under.matches('.plan-change, .plan-finding-area'))
                hit.push(under.getAttribute('class')!)
            }
          }
        }
        return { zone: el.getAttribute('data-zone'), hit }
      })
      expect(covered.hit, `zone label ${covered.zone} sits on a fill at ${width}px`).toEqual([])
    }

    const transitionDuration = await plan
      .locator('.plan-pin[data-finding="R1-1"] .plan-pin-disc')
      .evaluate((circle) => getComputedStyle(circle).transitionDuration)
    expect(
      transitionDuration.split(',').every((duration) => Number.parseFloat(duration) <= 0.00002),
    ).toBe(true)
  }

  for (const id of FINDING_IDS) {
    const sizes = hitSizes.get(id)
    expect(sizes, `${id} hit sizes should be collected at every viewport`).toHaveLength(
      VIEWPORTS.length,
    )
    const widths = sizes!.map(({ width }) => width)
    const heights = sizes!.map(({ height }) => height)
    expect(
      Math.max(...widths) - Math.min(...widths),
      `${id} hit width changes by viewport`,
    ).toBeLessThanOrEqual(0.1)
    expect(
      Math.max(...heights) - Math.min(...heights),
      `${id} hit height changes by viewport`,
    ).toBeLessThanOrEqual(0.1)
  }
})

import { expect, test, type Page } from '@playwright/test'

// Terrain textures are disposed when the terrain unmounts (#62). R3F releases a canvas's WebGL
// context on unmount, which frees its GPU memory without deleting each texture, so the check is
// per context: before the map's context goes, every texture filled from a pixel array (the
// aerial images; shadow maps get no pixels and badges upload a canvas) must have been deleted by
// our own dispose, and the live count must not grow from one visit to the next. three.js also
// keeps 1 x 1 placeholder textures filled from arrays for the whole context, so only textures at
// least 64 px wide count as images.

test.use({ reducedMotion: 'reduce' })

interface Probe {
  live: number
  data: number
  dataLive: number
  lost: boolean
}

/** Counts textures per WebGL context, and which of them were filled from a typed array. */
function countTextures() {
  type Ctx = {
    gl: WebGLRenderingContext
    live: Set<WebGLTexture>
    data: Set<WebGLTexture>
    bound: WebGLTexture | null
  }
  const ctxs: Ctx[] = []
  const of = (gl: WebGLRenderingContext) => {
    let c = ctxs.find((x) => x.gl === gl)
    if (!c) ctxs.push((c = { gl, live: new Set(), data: new Set(), bound: null }))
    return c
  }
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const p = C.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
    const wrap = (name: string, after: (c: Ctx, args: unknown[], out: unknown) => void) => {
      const orig = p[name]
      p[name] = function (this: WebGLRenderingContext, ...args: unknown[]) {
        const out = orig.apply(this, args)
        after(of(this), args, out)
        return out
      }
    }
    wrap('createTexture', (c, _a, t) => t && c.live.add(t as WebGLTexture))
    wrap('deleteTexture', (c, [t]) => c.live.delete(t as WebGLTexture))
    wrap('bindTexture', (c, [, t]) => (c.bound = (t as WebGLTexture) ?? null))
    // Width is argument 3 of texStorage2D and of the sized texImage2D form.
    const wide = new WeakSet<WebGLTexture>()
    for (const alloc of ['texStorage2D', 'texImage2D']) {
      wrap(alloc, (c, args) => {
        if (c.bound && typeof args[3] === 'number' && args[3] >= 64) wide.add(c.bound)
      })
    }
    for (const upload of ['texImage2D', 'texSubImage2D']) {
      wrap(upload, (c, args) => {
        if (c.bound && wide.has(c.bound) && args.some((a) => ArrayBuffer.isView(a))) {
          c.data.add(c.bound)
        }
      })
    }
  }
  ;(window as unknown as { __probe: () => Probe[] }).__probe = () =>
    ctxs.map((c) => ({
      live: c.live.size,
      data: c.data.size,
      dataLive: [...c.data].filter((t) => c.live.has(t)).length,
      lost: c.gl.isContextLost(),
    }))
}

const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: () => Probe[] }).__probe())

async function openMap(page: Page) {
  await page.evaluate(() => (location.hash = '#/monitor'))
  await expect(page.getByRole('group', { name: 'Camera view' })).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(async () => (await probe(page)).find((c) => !c.lost)?.data ?? 0)
    .toBeGreaterThanOrEqual(2)
}

async function openHome(page: Page) {
  await page.evaluate(() => (location.hash = '#/'))
  await expect(page.getByRole('group', { name: 'What the model shows' })).toBeVisible()
  await expect
    .poll(async () => (await probe(page)).filter((c) => !c.lost).length)
    .toBeLessThanOrEqual(1)
}

test('leaving the map disposes its aerial-image textures, and visits do not pile up textures', async ({
  page,
}) => {
  test.setTimeout(240_000)
  await page.addInitScript(countTextures)
  await page.goto('/#/')
  await expect(page.getByRole('group', { name: 'What the model shows' })).toBeVisible({
    timeout: 60_000,
  })

  const mapLive: number[] = []
  for (let visit = 0; visit < 3; visit++) {
    await openMap(page)
    const live = (await probe(page)).filter((c) => !c.lost)
    expect(live).toHaveLength(1)
    mapLive.push(live[0].live)
    await openHome(page)
  }

  const maps = (await probe(page)).filter((c) => c.lost && c.data >= 2)
  expect(maps.length).toBeGreaterThanOrEqual(3)
  // Both aerial images (current and baseline survey) were deleted before each context went.
  for (const m of maps) expect(m.dataLive).toBe(0)
  // Each visit holds the same number of textures as the last one.
  expect(new Set(mapLive).size).toBe(1)
})

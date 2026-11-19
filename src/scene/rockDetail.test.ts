import { describe, expect, it } from 'vitest'
import { DETAIL_TILE_M, ROCK_DETAIL_COLOR, ROCK_DETAIL_PARS, detailTile } from './rockDetail'

describe('close-range rock detail', () => {
  const tile = detailTile()
  const n = tile.size
  const metresPerTexel = DETAIL_TILE_M / n

  /**
   * Mean byte difference, per channel, between the tile and itself shifted by (dx, dy). Each channel
   * is drawn on its own, so each must be checked on its own.
   */
  const shiftDiff = (dx: number, dy: number) => {
    const sum = [0, 0, 0, 0]
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const a = (y * n + x) * 4
        const b = (((y + dy + n) % n) * n + ((x + dx + n) % n)) * 4
        for (let c = 0; c < 4; c++) sum[c] += Math.abs(tile.data[a + c] - tile.data[b + c])
      }
    }
    return Math.min(...sum) / (n * n)
  }

  it('maps the tile to the same world size in every lookup the shader makes', () => {
    const source = ROCK_DETAIL_PARS + ROCK_DETAIL_COLOR
    const lookups = source.match(/texture(?:2D|Grad)\(uDetail,[^;]+;/g) ?? []
    // One lookup on the vertical wall plane (called for two directions), one from above.
    expect(lookups).toHaveLength(2)
    const scale = `/ ${DETAIL_TILE_M.toFixed(1)}`
    // The wall lookup scales its coordinate and both gradients; the one from above its coordinate.
    const [wall = '', above = ''] = lookups
    expect(wall.split(scale)).toHaveLength(4)
    expect(above.split(scale)).toHaveLength(2)
  })

  it('does not repeat within 200 m: the tile has no period shorter than itself', () => {
    expect(DETAIL_TILE_M).toBeGreaterThan(200)
    // The tile wraps at n texels, so any shorter period divides n. A shift by a true period
    // matches a channel exactly; in every channel, every candidate must differ from it instead.
    for (let d = 1; d < n; d *= 2) {
      for (const [dx, dy] of [
        [d, 0],
        [0, d],
        [d, d],
        [d, -d],
      ]) {
        expect(shiftDiff(dx, dy), `shift of ${d * metresPerTexel} m`).toBeGreaterThan(0.1)
      }
    }
    expect(shiftDiff(n, 0)).toBe(0)
  })

  it('wraps without a seam', () => {
    // Across the wrap, neighbouring texels differ no more than neighbours inside the tile do.
    let inside = 0
    let wrap = 0
    for (let y = 0; y < n; y++) {
      for (let c = 0; c < 4; c++) {
        inside += Math.abs(
          tile.data[(y * n + n / 2) * 4 + c] - tile.data[(y * n + n / 2 - 1) * 4 + c],
        )
        wrap += Math.abs(tile.data[y * n * 4 + c] - tile.data[(y * n + n - 1) * 4 + c])
      }
    }
    expect(wrap).toBeLessThan(inside * 1.5)
  })
})

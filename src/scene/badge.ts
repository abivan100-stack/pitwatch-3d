import * as THREE from 'three'
import { OVERLAY, TONE_COLOR } from './palette'

/** The finding badge drawn on the map and on the landing model: severity shape, then the id. */
export const BADGE_W = 76
export const BADGE_H = 28

/** Polygon outline per tone, so the shape (not just the colour) tells the severity. */
const SHAPE = {
  warning: { sides: 3, turn: -Math.PI / 2 },
  violation: { sides: 8, turn: Math.PI / 8 },
  critical: { sides: 4, turn: 0 },
}

/** Paper badge: severity shape in the tone colour, then the finding id. */
export function badgeTexture(tone: keyof typeof SHAPE, id: string) {
  const px = 3
  const canvas = document.createElement('canvas')
  canvas.width = BADGE_W * px
  canvas.height = BADGE_H * px
  const c = canvas.getContext('2d')!
  c.scale(px, px)
  c.fillStyle = OVERLAY.lease
  c.strokeStyle = TONE_COLOR[tone]
  c.lineWidth = 2
  c.beginPath()
  c.roundRect(1, 1, BADGE_W - 2, BADGE_H - 2, (BADGE_H - 2) / 2)
  c.fill()
  c.stroke()
  const { sides, turn } = SHAPE[tone]
  const [cx, cy, r] = [15, BADGE_H / 2, 10.5]
  c.fillStyle = TONE_COLOR[tone]
  c.beginPath()
  for (let i = 0; i < sides; i++) {
    const t = turn + (i * 2 * Math.PI) / sides
    c.lineTo(cx + r * Math.cos(t), cy + r * Math.sin(t))
  }
  c.closePath()
  c.fill()
  // Same inner marks as the panel glyphs: cross for a violation, bar and dot otherwise.
  c.strokeStyle = OVERLAY.lease
  c.lineWidth = 1.8
  c.lineCap = 'round'
  c.beginPath()
  if (tone === 'violation') {
    c.moveTo(cx - 3.5, cy - 3.5)
    c.lineTo(cx + 3.5, cy + 3.5)
    c.moveTo(cx + 3.5, cy - 3.5)
    c.lineTo(cx - 3.5, cy + 3.5)
  } else {
    const dy = tone === 'warning' ? 1.5 : 0
    c.moveTo(cx, cy - 4 + dy)
    c.lineTo(cx, cy + 0.5 + dy)
    c.moveTo(cx, cy + 3.4 + dy)
    c.lineTo(cx, cy + 3.5 + dy)
  }
  c.stroke()
  c.fillStyle = OVERLAY.badgeInk
  c.font = '600 12px "JetBrains Mono Variable", ui-monospace, monospace'
  c.textBaseline = 'middle'
  c.fillText(id, 29, BADGE_H / 2 + 0.5)
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

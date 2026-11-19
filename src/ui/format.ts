const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const MONTH_FMT = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })

const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** "2025-11-14" -> "14 Nov 2025" */
export function formatDate(iso: string): string {
  return DATE_FMT.format(toMs(iso))
}

/** ISO date `days` after `iso`. */
export function addDays(iso: string, days: number): string {
  return new Date(toMs(iso) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Whole days from a to b (ISO dates). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / 86_400_000)
}

/**
 * First-of-month ticks strictly between two ISO dates, with their position
 * (0..1) along the a→b span. Used for the timeline axis.
 */
export function monthTicks(a: string, b: string): { label: string; t: number }[] {
  const start = toMs(a)
  const span = toMs(b) - start
  const d = new Date(start)
  const ticks: { label: string; t: number }[] = []
  let cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
  while (cursor < start + span) {
    ticks.push({ label: MONTH_FMT.format(cursor), t: (cursor - start) / span })
    const c = new Date(cursor)
    cursor = Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1)
  }
  return ticks
}

/** 21.7342 -> "21.7342° N" */
export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`
}

export function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`
}

/**
 * Readout of the landing date bar for story position `t` (0 = baseline, 1 = current survey).
 * Only the two ends are surveys; in between the model is a blend of them, so the readout says
 * so instead of naming a date and day.
 */
export function storyClockLabel(t: number, baseline: string, days: number): string {
  if (t <= 0.001) return `${days} days between surveys`
  if (t < 1) return 'Illustration between surveys'
  return `${formatDate(addDays(baseline, days))}, day ${days} of ${days}`
}

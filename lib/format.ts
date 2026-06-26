import { formatInTimeZone } from 'date-fns-tz'

// The trading day on this dashboard is anchored to America/New_York: bar data
// in mes-algo lives in ET, so trade timestamps must render in ET for users to
// reconcile fills against bars. The UTC ISO in the DB is correct — we only
// shift it at the display layer.
//
// "zzz" emits "EDT" or "EST" automatically based on the date's DST status, so
// callers never need to know whether a given trade fell inside daylight saving.
const TRADE_TZ = 'America/New_York'

export function fmtTradeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return formatInTimeZone(iso, TRADE_TZ, 'yyyy-MM-dd HH:mm zzz')
}

// Compact ET tooltip for chart timestamps (no seconds, no UTC offset noise).
// Example: "Apr 10, 2025 12:30 EDT".
export function fmtChartTimeET(ts: string | number | Date): string {
  return formatInTimeZone(ts, TRADE_TZ, 'MMM d, yyyy HH:mm zzz')
}

// Axis tick — short ET date for time-series x-axes.
export function fmtChartDateET(ts: string | number | Date): string {
  return formatInTimeZone(ts, TRADE_TZ, 'MMM dd')
}

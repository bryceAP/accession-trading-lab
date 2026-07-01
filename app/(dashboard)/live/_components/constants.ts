// Shared constants for the /live surface. This file is intentionally NOT
// marked 'use client' — Next.js 14 doesn't preserve non-component exports
// from client modules across the RSC boundary; when the server component
// (page.tsx) imported HONEST_DATA_CUTOFF_ISO directly from live-view.tsx,
// it arrived as an opaque reference that stringified to "[object Object]"
// inside the Supabase filter, breaking the query with:
//   invalid input syntax for type timestamp with time zone: "[object Object]"
// Keeping runtime values in a plain module avoids that trap.

// Honest-data reset. Two paper trades before this timestamp have broken
// slippage / PnL numbers — T1 was recorded with slippage=650, pnl=+387
// when actual was slippage≈0, pnl=−267; T2 never landed at all (clean-
// shutdown DB writer race). See mes-algo runners/paper.py fixes on
// 2026-07-01. Everything below this cutoff is filtered out at the query
// layer; the banner in live-view.tsx surfaces the recap.
export const HONEST_DATA_CUTOFF_ISO = '2026-07-01T14:47:00Z'

// Sum of the two pre-cutoff trades' actual (corrected) PnL. Shown in the
// disclosure banner so glancing at the 24h tally doesn't mislead.
export const PRE_CUTOFF_RECAP_USD = 1691

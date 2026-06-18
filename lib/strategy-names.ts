// Small helper that resolves a strategy's programmatic `name` to its
// human-readable `display_name`. The dashboard reads display_name as the
// primary label everywhere; this module also exposes a "key → label" helper
// so backtest list pages (which only know strategy_name, not strategy_id)
// can render the friendly label without doing a second round-trip.

import type { SupabaseClient } from '@supabase/supabase-js'

export type StrategyNameInfo = {
  id: string
  name: string | null
  display_name: string | null
}

export function strategyLabel(info: { display_name?: string | null; name?: string | null } | null | undefined, fallback?: string | null): string {
  if (!info) return fallback?.trim() || '—'
  const dn = info.display_name?.trim()
  if (dn) return dn
  const nm = info.name?.trim()
  if (nm) return nm
  return fallback?.trim() || '—'
}

// `lookupKey` covers both ways callers identify a strategy:
//   - by uuid (preferred)
//   - by programmatic name (older backtest rows write strategy_name only)
// Both keys point at the same StrategyNameInfo when known.
export type StrategyNameMap = Map<string, StrategyNameInfo>

export async function fetchStrategyNameMap(
  // SupabaseClient is generic over the db schema; we only use the table+columns
  // here, so SupabaseClient<any> is acceptable for this helper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<StrategyNameMap> {
  const { data, error } = await supabase
    .from('strategies')
    .select('id, name, display_name')
  if (error) {
    console.error('[fetchStrategyNameMap]', error)
    return new Map()
  }
  const map: StrategyNameMap = new Map()
  for (const row of (data ?? []) as StrategyNameInfo[]) {
    if (row.id) map.set(row.id, row)
    if (row.name) map.set(row.name, row)
  }
  return map
}

export function resolveStrategyName(
  map: StrategyNameMap | null | undefined,
  strategy_id: string | null | undefined,
  strategy_name: string | null | undefined,
): StrategyNameInfo | null {
  if (!map) return null
  if (strategy_id) {
    const v = map.get(strategy_id)
    if (v) return v
  }
  if (strategy_name) {
    const v = map.get(strategy_name)
    if (v) return v
  }
  return null
}

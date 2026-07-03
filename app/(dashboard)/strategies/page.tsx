import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { StrategiesList, type StrategyRow } from './_components/strategies-list'

type Strategy = {
  id: string
  name: string | null
  display_name: string | null
  version: string | null
  instrument: string | null
  description: string | null
  status: string | null
  updated_at: string | null
  archived_at: string | null
}

// Only the summary column is needed for the best-PnL badges. Selecting the
// full metrics jsonb per row scans a growing blob column for every backtest
// on every page load — this shape is O(N) rows × cheap column instead.
type BacktestLite = {
  strategy_id: string | null
  strategy_name: string | null
  net_pnl: number | string | null
}

export default async function StrategiesPage({
  searchParams,
}: {
  searchParams: { archived?: string }
}) {
  const supabase = createClient()
  const showArchived = searchParams.archived === '1'

  let stratQuery = supabase
    .from('strategies')
    .select('id, name, display_name, version, instrument, description, status, updated_at, archived_at')
    .order('updated_at', { ascending: false })
  if (!showArchived) stratQuery = stratQuery.is('archived_at', null)

  // Aggregate over active backtests only — archived ones shouldn't pollute
  // the "best PnL" badges on the card.
  const [stratRes, btRes, archivedRes] = await Promise.all([
    stratQuery,
    supabase
      .from('backtests')
      .select('strategy_id, strategy_name, net_pnl')
      .is('archived_at', null),
    supabase
      .from('strategies')
      .select('id', { count: 'exact', head: true })
      .not('archived_at', 'is', null),
  ])

  const errs = [stratRes.error, btRes.error].filter(Boolean)
  if (errs.length) console.error('[StrategiesList]', errs)

  const strategies = (stratRes.data ?? []) as Strategy[]
  const backtests = (btRes.data ?? []) as BacktestLite[]
  const archivedCount = archivedRes.count ?? 0

  // Build per-strategy aggregates: best total_pnl and backtest count.
  // Bucket by both strategy_id and strategy_name so we can look up either way.
  const bestById = new Map<string, number>()
  const bestByName = new Map<string, number>()
  const countById = new Map<string, number>()
  const countByName = new Map<string, number>()

  for (const bt of backtests) {
    // net_pnl is stored as `numeric` in Postgres, so supabase-js hands it
    // back as a string. Number("") returns 0 which would poison the max —
    // coerce with a NaN guard.
    const raw = bt.net_pnl == null ? null : Number(bt.net_pnl)
    const pnl = raw != null && Number.isFinite(raw) ? raw : null
    if (bt.strategy_id) {
      countById.set(bt.strategy_id, (countById.get(bt.strategy_id) ?? 0) + 1)
      if (pnl != null) {
        const cur = bestById.get(bt.strategy_id)
        if (cur == null || pnl > cur) bestById.set(bt.strategy_id, pnl)
      }
    }
    if (bt.strategy_name) {
      countByName.set(bt.strategy_name, (countByName.get(bt.strategy_name) ?? 0) + 1)
      if (pnl != null) {
        const cur = bestByName.get(bt.strategy_name)
        if (cur == null || pnl > cur) bestByName.set(bt.strategy_name, pnl)
      }
    }
  }

  const rows: StrategyRow[] = strategies.map((s) => ({
    id: s.id,
    name: s.name,
    display_name: s.display_name,
    version: s.version,
    instrument: s.instrument,
    description: s.description,
    status: s.status,
    updated_at: s.updated_at,
    archived_at: s.archived_at,
    bestPnl: bestById.get(s.id) ?? (s.name ? bestByName.get(s.name) ?? null : null),
    backtestCount: countById.get(s.id) ?? (s.name ? countByName.get(s.name) ?? 0 : 0),
  }))

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Strategies</h1>
        <div className="flex items-center gap-3">
          {stratRes.error ? (
            <Badge variant="destructive" className="text-xs">DB error</Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
              {rows.length} {showArchived ? 'total (incl. archived)' : 'active'}
            </span>
          )}
          <Link
            href={showArchived ? '/strategies' : '/strategies?archived=1'}
            className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
            {!showArchived && archivedCount ? (
              <span className="font-mono tabular-nums text-muted-foreground/70">
                ({archivedCount})
              </span>
            ) : null}
          </Link>
        </div>
      </div>

      <StrategiesList rows={rows} />
    </div>
  )
}

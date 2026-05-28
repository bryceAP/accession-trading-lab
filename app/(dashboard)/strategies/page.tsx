import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { StrategiesList, type StrategyRow } from './_components/strategies-list'
import { pickMetric } from '../backtests/_components/format'

type Strategy = {
  id: string
  name: string | null
  version: string | null
  instrument: string | null
  description: string | null
  status: string | null
  updated_at: string | null
}

type BacktestLite = {
  strategy_id: string | null
  strategy_name: string | null
  metrics: Record<string, unknown> | null
}

export default async function StrategiesPage() {
  const supabase = createClient()

  const [stratRes, btRes] = await Promise.all([
    supabase
      .from('strategies')
      .select('id, name, version, instrument, description, status, updated_at')
      .order('updated_at', { ascending: false }),
    supabase
      .from('backtests')
      .select('strategy_id, strategy_name, metrics'),
  ])

  const errs = [stratRes.error, btRes.error].filter(Boolean)
  if (errs.length) console.error('[StrategiesList]', errs)

  const strategies = (stratRes.data ?? []) as Strategy[]
  const backtests = (btRes.data ?? []) as BacktestLite[]

  // Build per-strategy aggregates: best total_pnl and backtest count.
  // Bucket by both strategy_id and strategy_name so we can look up either way.
  const bestById = new Map<string, number>()
  const bestByName = new Map<string, number>()
  const countById = new Map<string, number>()
  const countByName = new Map<string, number>()

  for (const bt of backtests) {
    const pnl = pickMetric(bt.metrics, 'total_pnl')
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
    version: s.version,
    instrument: s.instrument,
    description: s.description,
    status: s.status,
    updated_at: s.updated_at,
    bestPnl: bestById.get(s.id) ?? (s.name ? bestByName.get(s.name) ?? null : null),
    backtestCount: countById.get(s.id) ?? (s.name ? countByName.get(s.name) ?? 0 : 0),
  }))

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Strategies</h1>
        {stratRes.error ? (
          <Badge variant="destructive" className="text-xs">DB error</Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {rows.length} total
          </span>
        )}
      </div>

      <StrategiesList rows={rows} />
    </div>
  )
}

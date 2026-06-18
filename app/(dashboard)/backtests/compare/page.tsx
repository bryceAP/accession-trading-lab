import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { fetchStrategyNameMap, type StrategyNameInfo } from '@/lib/strategy-names'
import { CompareView, type CompareBacktest } from './_components/compare-view'

export default async function BacktestsComparePage() {
  const supabase = createClient()

  // equity_curve is intentionally NOT selected here — it's potentially huge
  // (1m runs produce 100k+ points) and the selector list never displays it.
  // CompareView fetches curves lazily for the runs the user actually picks.
  // config_snapshot feeds the per-run badges and the config diff table.
  const [{ data, error }, strategyMap] = await Promise.all([
    supabase
      .from('backtests')
      .select(
        'id, strategy_id, strategy_name, label, instrument, timeframe, start_date, end_date, completed_at, metrics, config_snapshot, archived_at, ' +
          'net_pnl, max_drawdown, win_rate, sharpe, profit_factor, trades_count',
      )
      .order('completed_at', { ascending: false }),
    fetchStrategyNameMap(supabase),
  ])

  const strategyDirectory: Record<string, StrategyNameInfo> = {}
  strategyMap.forEach((info, key) => {
    strategyDirectory[key] = info
  })

  if (error) console.error('[BacktestsCompare]', error)

  // Casting through unknown because the new typed summary columns aren't
  // in the generated Supabase types yet — once `supabase gen types` reruns
  // after the migration ships, this can be a direct cast.
  const rows = ((data ?? []) as unknown) as CompareBacktest[]

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div>
        <Link href="/backtests" className="text-xs text-muted-foreground hover:text-foreground">
          ← Backtests
        </Link>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-sm font-semibold tracking-tight">A/B comparison</h1>
          <p className="text-[11px] text-muted-foreground">
            Select two or more runs to overlay their equity curves and compare metrics side-by-side.
          </p>
        </div>
        {error ? (
          <Badge variant="destructive" className="text-xs">DB error</Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {rows.length} runs
          </span>
        )}
      </div>

      <Suspense fallback={<div className="text-xs text-muted-foreground">Loading…</div>}>
        <CompareView rows={rows} strategyDirectory={strategyDirectory} />
      </Suspense>
    </div>
  )
}

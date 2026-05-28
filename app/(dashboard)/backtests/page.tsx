import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { BacktestsTable, type BacktestRow } from './_components/backtests-table'

type BacktestQueryRow = Omit<BacktestRow, 'tradeCount'>

export default async function BacktestsPage() {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('backtests')
    .select('id, strategy_name, instrument, timeframe, start_date, end_date, completed_at, metrics, equity_curve')
    .order('completed_at', { ascending: false })

  if (error) console.error('[BacktestsList]', error)

  const queryRows = (data ?? []) as BacktestQueryRow[]

  // Trade count per backtest from the trades table — same source the detail
  // page uses to render the trades section, so the Trades column always
  // matches what's actually recorded (independent of metric-key naming).
  const ids = queryRows.map((r) => r.id)
  const tradeCountById = new Map<string, number>()
  if (ids.length > 0) {
    const { data: tradeRows, error: tradesErr } = await supabase
      .from('trades')
      .select('backtest_id')
      .in('backtest_id', ids)
    if (tradesErr) console.error('[BacktestsList trades]', tradesErr)
    for (const t of (tradeRows ?? []) as { backtest_id: string | null }[]) {
      if (!t.backtest_id) continue
      tradeCountById.set(t.backtest_id, (tradeCountById.get(t.backtest_id) ?? 0) + 1)
    }
  }

  const rows: BacktestRow[] = queryRows.map((r) => ({
    ...r,
    tradeCount: tradeCountById.get(r.id) ?? 0,
  }))

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Backtests</h1>
        {error ? (
          <Badge variant="destructive" className="text-xs">DB error</Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {rows.length} total
          </span>
        )}
      </div>

      <BacktestsTable rows={rows} />
    </div>
  )
}

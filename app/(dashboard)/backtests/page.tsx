import Link from 'next/link'
import { GitCompare } from 'lucide-react'
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
  // Use a server-side HEAD count per backtest: fetching `backtest_id` for all
  // trades at once gets truncated by Supabase's default row cap (~1000) when
  // the total trade count across all backtests exceeds it, which silently
  // undercounts every row.
  const ids = queryRows.map((r) => r.id)
  const tradeCountById = new Map<string, number>()
  if (ids.length > 0) {
    const counts = await Promise.all(
      ids.map(async (id) => {
        const { count, error: cErr } = await supabase
          .from('trades')
          .select('*', { count: 'exact', head: true })
          .eq('backtest_id', id)
        if (cErr) console.error('[BacktestsList trades]', id, cErr)
        return [id, count ?? 0] as const
      }),
    )
    for (const [id, n] of counts) tradeCountById.set(id, n)
  }

  const rows: BacktestRow[] = queryRows.map((r) => ({
    ...r,
    tradeCount: tradeCountById.get(r.id) ?? 0,
  }))

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-sm font-semibold tracking-tight">Backtests</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/backtests/compare"
            className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <GitCompare className="h-3 w-3" />
            Compare runs
          </Link>
          {error ? (
            <Badge variant="destructive" className="text-xs">DB error</Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
              {rows.length} total
            </span>
          )}
        </div>
      </div>

      <BacktestsTable rows={rows} />
    </div>
  )
}

import Link from 'next/link'
import { GitCompare } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { BacktestsTable, type BacktestRow } from './_components/backtests-table'

export default async function BacktestsPage() {
  const supabase = createClient()

  // Summary columns (net_pnl, max_drawdown, win_rate, sharpe, trades_count)
  // and duration_ms are populated by the runner per-row, so the list page
  // no longer pulls equity_curve jsonb or fans out N parallel HEAD counts
  // to derive those values. Older rows missing the columns fall back to
  // metrics jsonb in the table component.
  const { data, error } = await supabase
    .from('backtests')
    .select(
      'id, strategy_name, instrument, timeframe, start_date, end_date, completed_at, duration_ms, metrics, ' +
        'net_pnl, max_drawdown, win_rate, sharpe, trades_count',
    )
    .order('completed_at', { ascending: false })

  if (error) console.error('[BacktestsList]', error)

  // Casting through unknown because the new typed summary columns aren't
  // in the generated Supabase types yet — once `supabase gen types` reruns
  // after the migration ships, this can be a direct cast.
  const rows = ((data ?? []) as unknown) as BacktestRow[]

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

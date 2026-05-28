import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { BacktestsTable, type BacktestRow } from './_components/backtests-table'

export default async function BacktestsPage() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('backtests')
    .select('id, strategy_name, instrument, timeframe, start_date, end_date, completed_at, metrics, equity_curve')
    .order('completed_at', { ascending: false })

  const rows = (data ?? []) as BacktestRow[]

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

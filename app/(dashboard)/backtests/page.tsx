import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'

export default async function BacktestsPage() {
  const supabase = createClient()
  const { count, error } = await supabase
    .from('backtests')
    .select('*', { count: 'exact', head: true })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Backtests</h1>
        {error ? (
          <Badge variant="destructive" className="text-xs">DB error</Badge>
        ) : (
          <Badge variant="outline" className="text-xs border-positive/40 text-positive">
            Connected
          </Badge>
        )}
      </div>

      <div className="rounded border border-border bg-card p-4">
        <div className="text-xs text-muted-foreground mb-1">Total backtests</div>
        <div className="text-2xl font-mono font-semibold tabular-nums">{count ?? 0}</div>
      </div>

      <p className="text-xs text-muted-foreground">
        Backtest archive coming soon. Row count confirms Supabase connectivity.
      </p>
    </div>
  )
}

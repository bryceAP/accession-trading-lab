import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

export default async function BacktestDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const { data: backtest, error } = await supabase
    .from('backtests')
    .select('*')
    .eq('id', params.id)
    .single()

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/backtests" className="text-xs text-muted-foreground hover:text-foreground">
          ← Backtests
        </Link>
        {error ? (
          <Badge variant="destructive" className="text-xs">Not found</Badge>
        ) : null}
      </div>

      <h1 className="text-sm font-semibold tracking-tight">
        {backtest?.strategy_name ?? params.id}
      </h1>

      {backtest && (
        <div className="rounded border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
            <Row label="Instrument" value={backtest.instrument} />
            <Row label="Timeframe"  value={backtest.timeframe} />
            <Row label="Start"      value={backtest.start_date} />
            <Row label="End"        value={backtest.end_date} />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Backtest detail view coming soon.
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </>
  )
}

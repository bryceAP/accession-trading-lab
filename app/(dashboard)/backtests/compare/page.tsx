import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { CompareView, type CompareBacktest } from './_components/compare-view'

export default async function BacktestsComparePage() {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('backtests')
    .select('id, strategy_name, label, instrument, timeframe, start_date, end_date, completed_at, metrics, equity_curve')
    .order('completed_at', { ascending: false })

  if (error) console.error('[BacktestsCompare]', error)

  const rows = (data ?? []) as CompareBacktest[]

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
        <CompareView rows={rows} />
      </Suspense>
    </div>
  )
}

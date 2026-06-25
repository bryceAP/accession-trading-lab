import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { fetchStrategyNameMap, type StrategyNameInfo } from '@/lib/strategy-names'
import { BacktestsTable, type BacktestRow } from './_components/backtests-table'

export default async function BacktestsPage({
  searchParams,
}: {
  searchParams: { archived?: string }
}) {
  const supabase = createClient()
  const showArchived = searchParams.archived === '1'

  // Summary columns (net_pnl, max_drawdown, win_rate, sharpe, trades_count)
  // and duration_ms are populated by the runner per-row, so the list page
  // no longer pulls equity_curve jsonb or fans out N parallel HEAD counts
  // to derive those values. Older rows missing the columns fall back to
  // metrics jsonb in the table component.
  //
  // config_snapshot + label feed the structured badges (stop / mode /
  // session / span / fill-tf). label also fuels the "label contains"
  // filter and is the human-readable fallback when strategy_name is null.
  let query = supabase
    .from('backtests')
    .select(
      'id, strategy_id, strategy_name, label, instrument, timeframe, start_date, end_date, completed_at, duration_ms, metrics, config_snapshot, archived_at, ' +
        'net_pnl, gross_pnl, max_drawdown, win_rate, sharpe, trades_count, ' +
        'beta_es, alpha_daily, corr_es',
    )
    .order('completed_at', { ascending: false })

  if (!showArchived) query = query.is('archived_at', null)

  const [{ data, error }, strategyMap, archivedRes] = await Promise.all([
    query,
    fetchStrategyNameMap(supabase),
    // Count of archived rows so the "Show archived" toggle can show a hint.
    supabase
      .from('backtests')
      .select('id', { count: 'exact', head: true })
      .not('archived_at', 'is', null),
  ])
  const archivedCount = archivedRes.count ?? 0

  // Materialize the name → display_name lookup as a plain object so it can
  // cross the server/client boundary into BacktestsTable. Map() values do
  // serialize through Next but only via the Function payload; an object
  // keeps the shape obvious in the wire format.
  const strategyDirectory: Record<string, StrategyNameInfo> = {}
  strategyMap.forEach((info, key) => {
    strategyDirectory[key] = info
  })

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
          {error ? (
            <Badge variant="destructive" className="text-xs">DB error</Badge>
          ) : (
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
              {rows.length} {showArchived ? 'total (incl. archived)' : 'active'}
            </span>
          )}
          <Link
            href={showArchived ? '/backtests' : '/backtests?archived=1'}
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

      <Suspense fallback={<div className="text-xs text-muted-foreground">Loading…</div>}>
        <BacktestsTable rows={rows} strategyDirectory={strategyDirectory} />
      </Suspense>
    </div>
  )
}

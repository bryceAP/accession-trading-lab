import { createClient } from '@/lib/supabase/server'
import { LiveView, type LivePaperStatus, type LiveTrade, type LiveEvent } from './_components/live-view'

const TRADE_LIMIT = 100
const EVENT_LIMIT = 100
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export default async function LivePage() {
  const supabase = createClient()

  // Rolling 24-hour window instead of UTC midnight — a UTC cutoff hides
  // evening trades made in MT (America/Denver). For the dashboard's purposes
  // "last 24h" is what we want either way.
  const cutoffIso = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString()

  const [statusRes, tradesRes, eventsRes] = await Promise.all([
    supabase
      .from('paper_status')
      .select('id, strategy_name, is_running, started_at, last_heartbeat, position_qty, position_avg_price, daily_pnl, updated_at')
      .eq('id', 1)
      .maybeSingle(),
    supabase
      .from('trades')
      .select('id, entry_ts, exit_ts, side, entry_price, exit_price, quantity, pnl, commission, slippage, instrument, source')
      .eq('source', 'paper')
      .gte('entry_ts', cutoffIso)
      .order('entry_ts', { ascending: false })
      .limit(TRADE_LIMIT),
    supabase
      .from('events')
      .select('id, ts, event_type, source, data')
      .in('source', ['paper', 'live'])
      .order('ts', { ascending: false })
      .order('id', { ascending: false })
      .limit(EVENT_LIMIT),
  ])

  // Per-query diagnostics: log row count and any error so we can tell apart
  // "RLS returned 0 rows" from "SQL/HTTP error". The structured prefix makes
  // these easy to grep in Vercel runtime logs.
  console.log('[Live] paper_status', {
    rows: statusRes.data ? 1 : 0,
    error: statusRes.error?.message ?? null,
  })
  console.log('[Live] trades (source=paper, last 24h)', {
    rows: tradesRes.data?.length ?? 0,
    error: tradesRes.error?.message ?? null,
    cutoff: cutoffIso,
  })
  console.log('[Live] events (source in paper,live)', {
    rows: eventsRes.data?.length ?? 0,
    error: eventsRes.error?.message ?? null,
  })

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Live</h1>
        <span className="text-[10px] text-muted-foreground font-mono">read-only · last 24h</span>
      </div>

      <LiveView
        initialStatus={(statusRes.data ?? null) as LivePaperStatus | null}
        initialTrades={(tradesRes.data ?? []) as LiveTrade[]}
        initialEvents={(eventsRes.data ?? []) as LiveEvent[]}
        statusError={statusRes.error?.message ?? null}
        tradesError={tradesRes.error?.message ?? null}
        eventsError={eventsRes.error?.message ?? null}
      />
    </div>
  )
}

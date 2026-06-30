import { createClient } from '@/lib/supabase/server'
import { LiveView, type LivePaperStatus, type LiveTrade, type LiveEvent } from './_components/live-view'

const TRADE_LIMIT = 100
const EVENT_LIMIT = 100
const FILL_LOOKBACK_LIMIT = 500
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export default async function LivePage() {
  const supabase = createClient()

  // Rolling 24-hour window instead of UTC midnight — a UTC cutoff hides
  // evening trades made in MT (America/Denver). For the dashboard's purposes
  // "last 24h" is what we want either way.
  const cutoffIso = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString()
  const fillsCutoffIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()

  const [statusRes, tradesRes, eventsRes, openPosRes, fillsRes] = await Promise.all([
    supabase
      .from('paper_status')
      .select(
        'id, strategy_name, is_running, started_at, last_heartbeat, ' +
        'connection_state, instrument, position_side, position_qty, ' +
        'position_avg_price, current_price, unrealized_pnl, daily_pnl, updated_at'
      )
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
    // Latest position_opened — used to anchor time-in-trade on the open
    // position card. paper_status carries position_avg_price but not the
    // opening timestamp, so we read it from the event log.
    supabase
      .from('events')
      .select('id, ts, event_type, source, data')
      .eq('source', 'paper')
      .eq('event_type', 'position_opened')
      .order('ts', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // 7-day rolling slippage corpus — drives both today's avg and the 7-day
    // baseline on the SlippageStats panel. One query, client splits on the ET
    // midnight boundary.
    supabase
      .from('events')
      .select('id, ts, event_type, source, data')
      .eq('source', 'paper')
      .eq('event_type', 'order_filled')
      .gte('ts', fillsCutoffIso)
      .order('ts', { ascending: false })
      .limit(FILL_LOOKBACK_LIMIT),
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
  console.log('[Live] open position', {
    found: openPosRes.data ? 1 : 0,
    error: openPosRes.error?.message ?? null,
  })
  console.log('[Live] order_filled (last 7d)', {
    rows: fillsRes.data?.length ?? 0,
    error: fillsRes.error?.message ?? null,
    cutoff: fillsCutoffIso,
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
        initialOpenPosition={(openPosRes.data ?? null) as LiveEvent | null}
        initialFills={(fillsRes.data ?? []) as LiveEvent[]}
        statusError={statusRes.error?.message ?? null}
        tradesError={tradesRes.error?.message ?? null}
        eventsError={eventsRes.error?.message ?? null}
      />
    </div>
  )
}

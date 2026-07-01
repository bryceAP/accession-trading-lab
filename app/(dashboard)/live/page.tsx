import { createClient } from '@/lib/supabase/server'
import {
  LiveView,
  type LivePaperStatus,
  type LiveTrade,
  type LiveEvent,
  type DrawdownPoint,
  HONEST_DATA_CUTOFF_ISO,
} from './_components/live-view'

const TRADE_LIMIT = 200
const EVENT_LIMIT = 100
const DRAWDOWN_LIMIT = 5000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export default async function LivePage() {
  const supabase = createClient()

  // Rolling 24-hour window instead of UTC midnight — a UTC cutoff hides
  // evening trades made in MT (America/Denver). For the dashboard's purposes
  // "last 24h" is what we want either way.
  const feedCutoffIso = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString()
  const drawdownCutoffIso = new Date(Date.now() - THIRTY_DAYS_MS).toISOString()

  const [statusRes, tradesRes, eventsRes, openPosRes, ddRes] = await Promise.all([
    supabase
      .from('paper_status')
      .select(
        'id, strategy_name, is_running, started_at, last_heartbeat, ' +
        'connection_state, instrument, position_side, position_qty, ' +
        'position_avg_price, current_price, unrealized_pnl, daily_pnl, updated_at'
      )
      .eq('id', 1)
      .maybeSingle(),
    // 24h feed — filter by exit_ts so closed trades roll off the panel a day
    // after they close (not a day after they open). created_at cutoff drops
    // the two dirty pre-fix rows (see live-view HONEST_DATA_CUTOFF_ISO).
    supabase
      .from('trades')
      .select(
        'id, entry_ts, exit_ts, strategy_name, side, entry_price, exit_price, ' +
        'quantity, pnl, commission, slippage, exit_reason, instrument, source, created_at'
      )
      .eq('source', 'paper')
      .gte('exit_ts', feedCutoffIso)
      .gt('created_at', HONEST_DATA_CUTOFF_ISO)
      .order('exit_ts', { ascending: false })
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
    // 30-day trades series for drawdown. Only need exit_ts + pnl. Enforce
    // honest-data cutoff and non-null exit_ts so the cumulative pnl is
    // computed only on trades whose numbers we trust.
    supabase
      .from('trades')
      .select('exit_ts, pnl')
      .eq('source', 'paper')
      .gte('exit_ts', drawdownCutoffIso)
      .gt('created_at', HONEST_DATA_CUTOFF_ISO)
      .not('exit_ts', 'is', null)
      .order('exit_ts', { ascending: true })
      .limit(DRAWDOWN_LIMIT),
  ])

  // Per-query diagnostics: log row count and any error so we can tell apart
  // "RLS returned 0 rows" from "SQL/HTTP error". The structured prefix makes
  // these easy to grep in Vercel runtime logs.
  console.log('[Live] paper_status', {
    rows: statusRes.data ? 1 : 0,
    error: statusRes.error?.message ?? null,
  })
  console.log('[Live] trades (source=paper, exit_ts last 24h, post-cutoff)', {
    rows: tradesRes.data?.length ?? 0,
    error: tradesRes.error?.message ?? null,
    cutoff: feedCutoffIso,
  })
  console.log('[Live] events (source in paper,live)', {
    rows: eventsRes.data?.length ?? 0,
    error: eventsRes.error?.message ?? null,
  })
  console.log('[Live] open position', {
    found: openPosRes.data ? 1 : 0,
    error: openPosRes.error?.message ?? null,
  })
  console.log('[Live] drawdown series (30d post-cutoff)', {
    rows: ddRes.data?.length ?? 0,
    error: ddRes.error?.message ?? null,
    cutoff: drawdownCutoffIso,
  })

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Live</h1>
        <span className="text-[10px] text-muted-foreground font-mono">read-only · last 24h</span>
      </div>

      <LiveView
        initialStatus={(statusRes.data ?? null) as unknown as LivePaperStatus | null}
        initialTrades={(tradesRes.data ?? []) as unknown as LiveTrade[]}
        initialEvents={(eventsRes.data ?? []) as unknown as LiveEvent[]}
        initialOpenPosition={(openPosRes.data ?? null) as unknown as LiveEvent | null}
        initialDrawdownSeries={(ddRes.data ?? []) as unknown as DrawdownPoint[]}
        statusError={statusRes.error?.message ?? null}
        tradesError={tradesRes.error?.message ?? null}
        eventsError={eventsRes.error?.message ?? null}
      />
    </div>
  )
}

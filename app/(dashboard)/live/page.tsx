import { createClient } from '@/lib/supabase/server'
import {
  LiveView,
  type LivePaperStatus,
  type LiveTrade,
  type LiveEvent,
} from './_components/live-view'
import { HONEST_DATA_CUTOFF_ISO } from './_components/constants'

const TRADE_LIMIT = 200
const EVENT_LIMIT = 100

// ET midnight for "today's paper trades." Falls back to the last 24h if
// we're in the first minutes after midnight and want the previous session's
// tail still visible — simplest to just anchor at ET midnight and let the
// early-morning gap show as "no trades yet today."
function etTodayStartIso(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now)
  const o: Record<string, string> = {}
  for (const p of parts) o[p.type] = p.value
  const nyAsUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second)
  const offMin = Math.round((nyAsUtc - now.getTime()) / 60000)
  const naiveMidnightUtc = Date.UTC(+o.year, +o.month - 1, +o.day, 0, 0, 0)
  return new Date(naiveMidnightUtc - offMin * 60000).toISOString()
}

export default async function LivePage() {
  const supabase = createClient()

  const feedCutoffIso = etTodayStartIso()

  const [statusRes, tradesRes, eventsRes, openPosRes] = await Promise.all([
    supabase
      .from('paper_status')
      .select(
        'id, strategy_name, is_running, started_at, last_heartbeat, ' +
        'connection_state, instrument, position_side, position_qty, ' +
        'position_avg_price, current_price, unrealized_pnl, daily_pnl, updated_at'
      )
      .eq('id', 1)
      .maybeSingle(),
    // Today's paper trades — filter by exit_ts >= ET midnight. created_at
    // cutoff drops the two dirty pre-fix rows silently (see
    // live-view HONEST_DATA_CUTOFF_ISO); when trades.archived_at ships from
    // backend this filter can go and Bryce archives them from Overview.
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
  ])

  console.log('[Live] paper_status', {
    rows: statusRes.data ? 1 : 0,
    error: statusRes.error?.message ?? null,
  })
  console.log('[Live] trades (source=paper, exit_ts >= ET today midnight)', {
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

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Live</h1>
        <span className="text-[10px] text-muted-foreground font-mono">
          today · times in ET
        </span>
      </div>

      <LiveView
        initialStatus={(statusRes.data ?? null) as unknown as LivePaperStatus | null}
        initialTrades={(tradesRes.data ?? []) as unknown as LiveTrade[]}
        initialEvents={(eventsRes.data ?? []) as unknown as LiveEvent[]}
        initialOpenPosition={(openPosRes.data ?? null) as unknown as LiveEvent | null}
        statusError={statusRes.error?.message ?? null}
        tradesError={tradesRes.error?.message ?? null}
        eventsError={eventsRes.error?.message ?? null}
      />
    </div>
  )
}

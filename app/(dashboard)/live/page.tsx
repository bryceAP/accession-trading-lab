import { createClient } from '@/lib/supabase/server'
import { LiveView, type LivePaperStatus, type LiveTrade, type LiveEvent } from './_components/live-view'

const TRADE_LIMIT = 100
const EVENT_LIMIT = 100

export default async function LivePage() {
  const supabase = createClient()

  const now = new Date()
  const todayStartUtc = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  )).toISOString()

  const [statusRes, tradesRes, eventsRes] = await Promise.all([
    supabase
      .from('paper_status')
      .select('id, strategy_name, is_running, started_at, last_heartbeat, position_qty, position_avg_price, daily_pnl, updated_at')
      .eq('id', 1)
      .maybeSingle(),
    supabase
      .from('trades')
      .select('id, entry_ts, exit_ts, side, entry_price, exit_price, quantity, pnl, commission, slippage, instrument, source')
      .in('source', ['paper', 'live'])
      .gte('entry_ts', todayStartUtc)
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

  const errs = [statusRes.error, tradesRes.error, eventsRes.error].filter(Boolean)
  if (errs.length) console.error('[Live]', errs)

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Live</h1>
        <span className="text-[10px] text-muted-foreground font-mono">read-only</span>
      </div>

      <LiveView
        initialStatus={(statusRes.data ?? null) as LivePaperStatus | null}
        initialTrades={(tradesRes.data ?? []) as LiveTrade[]}
        initialEvents={(eventsRes.data ?? []) as LiveEvent[]}
      />
    </div>
  )
}

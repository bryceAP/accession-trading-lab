import { createClient } from '@/lib/supabase/server'
import {
  OverviewView,
  type Group,
  type PaperTradeRow,
  type RunnerSnapshot,
  type RecentBacktest,
} from './_overview/overview-view'
import { HONEST_DATA_CUTOFF_ISO } from './live/_components/constants'

// Overview is a windowed snapshot of paper-trade history. /live carries the
// realtime feed. Revalidate on request so an open tab picks up new state.
export const revalidate = 30

// Column set we'd love to have. archived_at may not exist on the trades
// table yet — page.tsx retries without it if the DB rejects the select.
const COLS_WITH_ARCHIVE =
  'id, entry_ts, exit_ts, side, quantity, entry_price, exit_price, ' +
  'pnl, commission, slippage, exit_reason, strategy_name, instrument, ' +
  'created_at, archived_at, source'

const COLS_WITHOUT_ARCHIVE =
  'id, entry_ts, exit_ts, side, quantity, entry_price, exit_price, ' +
  'pnl, commission, slippage, exit_reason, strategy_name, instrument, ' +
  'created_at, source'

const RECENT_BACKTESTS_LIMIT = 8
const DAYS = 24 * 60 * 60 * 1000

function windowStartIso(group: Group): string {
  // Windows sized so the bucket table has ~30/12/12 rows respectively.
  const days = group === 'day' ? 30 : group === 'week' ? 7 * 12 : 31 * 12
  return new Date(Date.now() - days * DAYS).toISOString()
}

function parseGroup(v: string | undefined): Group {
  if (v === 'week' || v === 'month') return v
  return 'day'
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: { group?: string; archived?: string }
}) {
  const supabase = createClient()
  const group = parseGroup(searchParams.group)
  const showArchived = searchParams.archived === '1'
  const cutoffIso = windowStartIso(group)

  // Kick off status + recent-backtests fetches alongside the main trades
  // query — none of them depend on each other.
  const statusReq = supabase
    .from('paper_status')
    .select('is_running, last_heartbeat, strategy_name, instrument, position_side, connection_state, started_at')
    .eq('id', 1)
    .maybeSingle()

  const backtestsReq = supabase
    .from('backtests')
    .select(
      'id, label, strategy_name, instrument, timeframe, completed_at, net_pnl, sharpe, trades_count, max_drawdown, archived_at',
    )
    .is('archived_at', null)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(RECENT_BACKTESTS_LIMIT)

  // Try to select trades with archived_at first. If the column doesn't
  // exist yet (backend hasn't shipped the migration), fall back to a
  // select without it and let the client render a "backend column
  // missing" banner.
  let rows: PaperTradeRow[] = []
  let archiveColumnAvailable = true
  let archivedCount = 0

  // Two paths: with archive (no honest-data cutoff — Bryce archives dirty
  // rows explicitly) and without archive (cutoff still applied as fallback
  // to hide T1/T2 until the column ships).
  const [firstTry, statusRes, backtestsRes] = await Promise.all([
    supabase
      .from('trades')
      .select(COLS_WITH_ARCHIVE)
      .eq('source', 'paper')
      .gte('exit_ts', cutoffIso)
      .order('exit_ts', { ascending: false })
      .limit(5000),
    statusReq,
    backtestsReq,
  ])

  if (firstTry.error) {
    const msg = firstTry.error.message ?? ''
    const columnMissing = /archived_at/.test(msg) && /(column|does not exist)/i.test(msg)
    if (columnMissing) {
      archiveColumnAvailable = false
      const fallback = await supabase
        .from('trades')
        .select(COLS_WITHOUT_ARCHIVE)
        .eq('source', 'paper')
        .gt('created_at', HONEST_DATA_CUTOFF_ISO)
        .gte('exit_ts', cutoffIso)
        .order('exit_ts', { ascending: false })
        .limit(5000)
      if (fallback.error) {
        console.error('[Overview] fallback query failed', fallback.error)
      } else {
        rows = ((fallback.data ?? []) as unknown as Omit<PaperTradeRow, 'archived_at'>[])
          .map((r) => ({ ...r, archived_at: null }))
      }
    } else {
      console.error('[Overview] query failed', firstTry.error)
    }
  } else {
    rows = (firstTry.data ?? []) as unknown as PaperTradeRow[]
  }

  if (archiveColumnAvailable) {
    archivedCount = rows.filter((r) => r.archived_at != null).length
    if (!showArchived) {
      rows = rows.filter((r) => r.archived_at == null)
    }
  }

  const runner = (statusRes.data ?? null) as unknown as RunnerSnapshot | null
  const recentBacktests = (backtestsRes.data ?? []) as unknown as RecentBacktest[]

  console.log('[Overview] trades', {
    group,
    showArchived,
    archiveColumnAvailable,
    rows: rows.length,
    archivedCount,
    cutoff: cutoffIso,
  })
  console.log('[Overview] runner', {
    running: runner?.is_running ?? null,
    strategy: runner?.strategy_name ?? null,
    error: statusRes.error?.message ?? null,
  })
  console.log('[Overview] recent backtests', {
    rows: recentBacktests.length,
    error: backtestsRes.error?.message ?? null,
  })

  return (
    <OverviewView
      trades={rows}
      group={group}
      showArchived={showArchived}
      archivedCount={archivedCount}
      archiveColumnAvailable={archiveColumnAvailable}
      runner={runner}
      recentBacktests={recentBacktests}
    />
  )
}

import { createClient } from '@/lib/supabase/server'
import { OverviewView, type Group, type PaperTradeRow } from './_overview/overview-view'
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

  // Try to select with archived_at first. If the column doesn't exist yet
  // (backend hasn't shipped the migration), fall back to a select without
  // it and let the client render a "backend column missing" banner.
  let rows: PaperTradeRow[] = []
  let archiveColumnAvailable = true
  let archivedCount = 0

  const firstTry = await supabase
    .from('trades')
    .select(COLS_WITH_ARCHIVE)
    .eq('source', 'paper')
    .gt('created_at', HONEST_DATA_CUTOFF_ISO)
    .gte('exit_ts', cutoffIso)
    .order('exit_ts', { ascending: false })
    .limit(5000)

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
        // Synthesize archived_at=null so the client type is uniform.
        rows = ((fallback.data ?? []) as unknown as Omit<PaperTradeRow, 'archived_at'>[])
          .map((r) => ({ ...r, archived_at: null }))
      }
    } else {
      console.error('[Overview] query failed', firstTry.error)
    }
  } else {
    rows = (firstTry.data ?? []) as unknown as PaperTradeRow[]
  }

  // Filter archived rows out of the default view; count archived rows in
  // the window regardless so the toggle can show the count hint.
  if (archiveColumnAvailable) {
    archivedCount = rows.filter((r) => r.archived_at != null).length
    if (!showArchived) {
      rows = rows.filter((r) => r.archived_at == null)
    }
  }

  console.log('[Overview] trades', {
    group,
    showArchived,
    archiveColumnAvailable,
    rows: rows.length,
    archivedCount,
    cutoff: cutoffIso,
  })

  return (
    <OverviewView
      trades={rows}
      group={group}
      showArchived={showArchived}
      archivedCount={archivedCount}
      archiveColumnAvailable={archiveColumnAvailable}
    />
  )
}

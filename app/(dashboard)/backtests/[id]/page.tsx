import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { EquityChart, type EquityPoint, type TradeMarker } from '../_components/equity-chart'
import { DrawdownChart } from '../_components/drawdown-chart'
import { NotesThread, type Note } from '../_components/notes-thread'
import {
  asNumber,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtUsd,
  formatMetricValue,
  metricKind,
  metricLabel,
  pnlClass,
  relativeTime,
} from '../_components/format'

type Backtest = {
  id: string
  strategy_name: string | null
  instrument: string | null
  timeframe: string | null
  start_date: string | null
  end_date: string | null
  completed_at: string | null
  metrics: Record<string, unknown> | null
  equity_curve: unknown
  // Optional runner-populated aggregate; falls back to client compute when absent.
  exit_breakdown: unknown
}

// Pagination + plot caps. Supabase caps a single .select() at ~1000 rows, so
// summary panels were silently undercounting on high-frequency runs (1m cells
// often produce 10k+ trades). We fan out across pages and cap rendering.
const TRADE_PAGE_SIZE = 1000
const TRADE_FETCH_CONCURRENCY = 8
const TRADES_TABLE_MAX = 1000
const EQUITY_PLOT_MAX = 2000
const MARKER_PLOT_MAX = 500
const TRADE_COLUMNS =
  'id, entry_ts, exit_ts, side, entry_price, exit_price, quantity, pnl, commission, slippage, source, exit_reason'

type Trade = {
  id: string | number
  entry_ts: string | null
  exit_ts: string | null
  side: string | null
  entry_price: number | null
  exit_price: number | null
  quantity: number | null
  pnl: number | null
  commission: number | null
  slippage: number | null
  source: string | null
  exit_reason: string | null
}

function normalizeEquityCurve(raw: unknown): EquityPoint[] {
  if (!Array.isArray(raw)) return []
  const out: EquityPoint[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const obj = p as Record<string, unknown>
    const ts = obj.ts ?? obj.timestamp ?? obj.time ?? obj.t ?? obj.date
    const equity = obj.equity ?? obj.value ?? obj.v ?? obj.balance
    if ((typeof ts === 'string' || typeof ts === 'number') && typeof equity === 'number') {
      out.push({ ts, equity })
    }
  }
  return out
}

function tradesToMarkers(trades: Trade[]): TradeMarker[] {
  return trades
    .filter((t) => t.exit_ts != null && t.pnl != null)
    .map((t) => ({
      exit_ts: t.exit_ts as string,
      pnl: t.pnl as number,
      side: t.side,
      entry_price: t.entry_price,
      exit_price: t.exit_price,
      entry_ts: t.entry_ts,
    }))
}

// Even-stride downsample, always preserving the last element so the chart
// reflects the final equity / latest trade.
function stride<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  const step = Math.ceil(arr.length / max)
  const out: T[] = []
  for (let i = 0; i < arr.length; i += step) out.push(arr[i])
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1])
  return out
}

async function fetchAllTrades(
  supabase: ReturnType<typeof createClient>,
  backtestId: string,
): Promise<Trade[]> {
  const { count, error: countErr } = await supabase
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .eq('backtest_id', backtestId)
  if (countErr) {
    console.error('[BacktestDetail trades count]', backtestId, countErr)
    return []
  }
  const total = count ?? 0
  if (total === 0) return []

  const pages = Math.ceil(total / TRADE_PAGE_SIZE)
  const pageResults: Trade[][] = new Array(pages)
  let next = 0

  async function worker() {
    while (true) {
      const i = next++
      if (i >= pages) return
      const from = i * TRADE_PAGE_SIZE
      const to = from + TRADE_PAGE_SIZE - 1
      const { data, error } = await supabase
        .from('trades')
        .select(TRADE_COLUMNS)
        .eq('backtest_id', backtestId)
        // Secondary order on id keeps pagination deterministic when entry_ts ties.
        .order('entry_ts', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true })
        .range(from, to)
      if (error) {
        console.error('[BacktestDetail trades page]', backtestId, i, error)
        pageResults[i] = []
        return
      }
      pageResults[i] = (data ?? []) as Trade[]
    }
  }

  const workers = Math.min(TRADE_FETCH_CONCURRENCY, pages)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return pageResults.flat()
}

function parseStoredExitBreakdown(raw: unknown): ExitReasonGroup[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: ExitReasonGroup[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const g = item as Record<string, unknown>
    const reason = typeof g.reason === 'string' ? g.reason : g.reason === null ? null : null
    const total = parseSideAgg(g.total)
    const long = parseSideAgg(g.long)
    const short = parseSideAgg(g.short)
    if (!total || !long || !short) return null
    out.push({ reason, total, long, short })
  }
  return out
}

function parseSideAgg(raw: unknown): SideAgg | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const count = pickNum(o, ['count'])
  const netPnl = pickNum(o, ['netPnl', 'net_pnl'])
  const wins = pickNum(o, ['wins'])
  const withPnl = pickNum(o, ['withPnl', 'with_pnl'])
  if (count == null || netPnl == null || wins == null || withPnl == null) return null
  return { count, netPnl, wins, withPnl }
}

function pickNum(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

export default async function BacktestDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()

  // The trades fetch is split out and paginated; it's not safe to await it
  // alongside the others because we don't yet know if the backtest exists.
  const [btRes, notesRes] = await Promise.all([
    supabase
      .from('backtests')
      .select('id, strategy_name, instrument, timeframe, start_date, end_date, completed_at, metrics, equity_curve, exit_breakdown')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('notes')
      .select('id, author, body, created_at')
      .eq('target_type', 'backtest')
      .eq('target_id', params.id)
      .order('created_at', { ascending: false }),
  ])

  if (btRes.error) console.error('[BacktestDetail backtest]', params.id, btRes.error)
  if (notesRes.error) console.error('[BacktestDetail notes]', params.id, notesRes.error)

  const backtest = btRes.data as Backtest | null
  const notes = (notesRes.data ?? []) as Note[]

  if (!backtest) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/backtests" className="text-xs text-muted-foreground hover:text-foreground">
            ← Backtests
          </Link>
          <Badge variant="destructive" className="text-xs">Not found</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          No backtest with id <span className="font-mono">{params.id}</span>.
        </p>
      </div>
    )
  }

  // Pull ALL trades — Supabase caps a single select at ~1000 rows, so
  // summary panels were silently undercounting on high-frequency runs.
  const trades = await fetchAllTrades(supabase, params.id)

  // The curve and markers feed the chart only; downsample so 1m runs with
  // 50k+ points don't blow up render. Costs and breakdown still sum over the
  // full trades array.
  const fullEquityCurve = normalizeEquityCurve(backtest.equity_curve)
  const equityCurve = stride(fullEquityCurve, EQUITY_PLOT_MAX)
  const allMarkers = tradesToMarkers(trades)
  const tradeMarkers = stride(allMarkers, MARKER_PLOT_MAX)
  const equityDownsampled = fullEquityCurve.length > equityCurve.length
  const markersDownsampled = allMarkers.length > tradeMarkers.length

  const completed = backtest.completed_at ? new Date(backtest.completed_at) : null
  const metrics = backtest.metrics ?? {}

  // Trading-cost summary, computed over ALL trades. Treat each trade's pnl
  // as gross (price-action) PnL and commission/slippage as additive costs.
  // Net = gross − commission − slippage. Null fields (older trades recorded
  // before those columns existed) are skipped so they don't poison totals.
  const hasAnyCommission = trades.some((t) => t.commission != null)
  const hasAnySlippage = trades.some((t) => t.slippage != null)
  const totalCommission = trades.reduce((acc, t) => acc + (t.commission ?? 0), 0)
  const totalSlippage = trades.reduce((acc, t) => acc + (t.slippage ?? 0), 0)
  const grossPnl = trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
  const netPnl = grossPnl - totalCommission - totalSlippage

  // Source label: trades for a backtest run all share the same source. If
  // no trades are recorded yet, the page is a /backtests/* route so the
  // safe default is "estimated".
  const runSource = trades[0]?.source ?? 'backtest'
  const costsKind: 'estimated' | 'actual' = runSource === 'backtest' ? 'estimated' : 'actual'

  // Prefer the runner-stored aggregate when present; fall back to client compute
  // so existing rows (and runs predating the column) still render.
  const exitBreakdown =
    parseStoredExitBreakdown(backtest.exit_breakdown) ?? buildExitBreakdown(trades)

  const renderedTrades =
    trades.length > TRADES_TABLE_MAX ? trades.slice(0, TRADES_TABLE_MAX) : trades
  const tradesTruncated = trades.length > TRADES_TABLE_MAX

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      {/* ── Back link ─────────────────────────────────────────── */}
      <div>
        <Link href="/backtests" className="text-xs text-muted-foreground hover:text-foreground">
          ← Backtests
        </Link>
      </div>

      {/* ── Header ────────────────────────────────────────────── */}
      <header className="rounded border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="space-y-1">
            <h1 className="text-sm font-semibold tracking-tight">
              {backtest.strategy_name ?? params.id}
            </h1>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-muted-foreground font-mono">
              <span>{backtest.instrument ?? '—'}</span>
              <span className="text-muted-foreground/40">·</span>
              <span>{backtest.timeframe ?? '—'}</span>
              <span className="text-muted-foreground/40">·</span>
              <span>
                {fmtDate(backtest.start_date)} <span className="text-muted-foreground/40">→</span> {fmtDate(backtest.end_date)}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Completed</div>
            <div
              className="text-xs font-mono tabular-nums"
              title={backtest.completed_at ?? undefined}
            >
              {completed ? relativeTime(completed) : '—'}
            </div>
            {completed && (
              <div className="text-[10px] text-muted-foreground font-mono">
                {fmtDateTime(backtest.completed_at)}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Equity curve (hero) ───────────────────────────────── */}
      <section className="rounded border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Equity curve
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono">
            {equityCurve.length.toLocaleString()}
            {equityDownsampled && ` of ${fullEquityCurve.length.toLocaleString()}`} pts
            {' · '}
            {tradeMarkers.length.toLocaleString()}
            {markersDownsampled && ` of ${allMarkers.length.toLocaleString()}`} marker{tradeMarkers.length === 1 ? '' : 's'}
          </span>
        </div>
        <EquityChart curve={equityCurve} trades={tradeMarkers} />
      </section>

      {/* ── Drawdown ──────────────────────────────────────────── */}
      <section className="rounded border border-border bg-card p-4 space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Drawdown
        </h2>
        <DrawdownChart curve={equityCurve} />
      </section>

      {/* ── Metrics ───────────────────────────────────────────── */}
      <section className="rounded border border-border bg-card p-4 space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Metrics
        </h2>
        {Object.keys(metrics).length === 0 ? (
          <div className="text-xs text-muted-foreground">No metrics recorded.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            {Object.entries(metrics).map(([k, v]) => {
              const kind = metricKind(k)
              const n = asNumber(v)
              const colored = kind === 'usd' && n != null
              return (
                <div key={k} className="space-y-0.5">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{metricLabel(k)}</div>
                  <div className={cn(
                    'font-mono tabular-nums text-sm',
                    colored && pnlClass(n),
                  )}>
                    {formatMetricValue(k, v)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Trading costs ─────────────────────────────────────── */}
      {trades.length > 0 && (
        <section className="rounded border border-border bg-card p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Trading costs
            </h2>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase',
                costsKind === 'actual'
                  ? 'border-[var(--positive)]/30 text-[var(--positive)] bg-[var(--positive)]/10'
                  : 'border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning)]/10',
              )}
              title={`source: ${runSource}`}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  costsKind === 'actual' ? 'bg-[var(--positive)]' : 'bg-[var(--warning)]',
                )}
              />
              {costsKind}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CostStat
              label="Total commission"
              value={hasAnyCommission ? fmtUsd(totalCommission) : '—'}
              cls="text-[var(--negative)]"
            />
            <CostStat
              label="Total slippage"
              value={hasAnySlippage ? fmtUsd(totalSlippage) : '—'}
              cls="text-[var(--negative)]"
            />
            <CostStat
              label="Gross P&L"
              value={fmtUsd(grossPnl, { signed: true })}
              cls={pnlClass(grossPnl)}
            />
            <CostStat
              label="Net P&L"
              value={fmtUsd(netPnl, { signed: true })}
              cls={pnlClass(netPnl)}
              emphasis
            />
          </div>
        </section>
      )}

      {/* ── Price chart placeholder ───────────────────────────── */}
      <section className="rounded border border-border border-dashed bg-card/50 p-6 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Price chart
        </div>
        <div className="text-xs text-muted-foreground">
          Price chart with trade annotations — coming soon.
        </div>
      </section>

      {/* ── Exit breakdown ────────────────────────────────────── */}
      {exitBreakdown.length > 0 && (
        <section className="rounded border border-border bg-card p-4 space-y-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Exit breakdown
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {exitBreakdown.map((g) => (
              <ExitReasonCard key={g.reason} group={g} />
            ))}
          </div>
        </section>
      )}

      {/* ── Trades table ──────────────────────────────────────── */}
      <section className="rounded border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Trades
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {tradesTruncated
              ? `${renderedTrades.length.toLocaleString()} of ${trades.length.toLocaleString()}`
              : trades.length.toLocaleString()}
          </span>
        </div>
        <TradesTable trades={renderedTrades} />
        {tradesTruncated && (
          <div className="border-t border-border bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground font-mono">
            Showing first {TRADES_TABLE_MAX.toLocaleString()} of {trades.length.toLocaleString()} trades.
            All summary panels above include the full set.
          </div>
        )}
      </section>

      {/* ── Notes ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Notes
        </h2>
        <NotesThread backtestId={params.id} notes={notes} />
      </section>
    </div>
  )
}

function TradesTable({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
        No trades for this backtest.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">Entry</th>
            <th className="px-3 py-2 text-left font-semibold">Exit</th>
            <th className="px-3 py-2 text-left font-semibold">Side</th>
            <th className="px-3 py-2 text-right font-semibold">Entry px</th>
            <th className="px-3 py-2 text-right font-semibold">Exit px</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">P&L</th>
            <th className="px-3 py-2 text-right font-semibold">Commission</th>
            <th className="px-3 py-2 text-right font-semibold">Slippage</th>
            <th className="px-3 py-2 text-left font-semibold">Exit reason</th>
            <th className="px-3 py-2 text-right font-semibold">Duration</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const entryMs = t.entry_ts ? new Date(t.entry_ts).getTime() : null
            const exitMs = t.exit_ts ? new Date(t.exit_ts).getTime() : null
            const duration = entryMs && exitMs ? exitMs - entryMs : null
            const sideClass =
              (t.side ?? '').toLowerCase().startsWith('s') ? 'text-[var(--negative)]' : 'text-[var(--positive)]'
            return (
              <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
                <td className="px-3 py-1.5 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                  {fmtDateTime(t.entry_ts)}
                </td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                  {fmtDateTime(t.exit_ts)}
                </td>
                <td className={cn('px-3 py-1.5 font-mono uppercase text-[11px]', sideClass)}>
                  {t.side ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {t.entry_price != null ? t.entry_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {t.exit_price != null ? t.exit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {t.quantity != null ? t.quantity.toLocaleString('en-US') : '—'}
                </td>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', pnlClass(t.pnl))}>
                  {t.pnl == null ? '—' : fmtUsd(t.pnl, { signed: true })}
                </td>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', t.commission != null && 'text-[var(--negative)]')}>
                  {t.commission == null ? '—' : fmtUsd(t.commission)}
                </td>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', t.slippage != null && 'text-[var(--negative)]')}>
                  {t.slippage == null ? '—' : fmtUsd(t.slippage)}
                </td>
                <td className="px-3 py-1.5">
                  <ExitReasonBadge reason={t.exit_reason} />
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                  {fmtDuration(duration)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CostStat({
  label,
  value,
  cls,
  emphasis,
}: {
  label: string
  value: string
  cls?: string
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded border bg-card px-3 py-2.5 space-y-1',
        emphasis ? 'border-foreground/20' : 'border-border',
      )}
    >
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</div>
      <div className={cn('font-mono tabular-nums', emphasis ? 'text-base font-semibold' : 'text-sm', cls)}>
        {value}
      </div>
    </div>
  )
}

const EXIT_REASON_ORDER = ['target', 'hard_stop', 'structural_stop', 'force_flat', 'other'] as const
const EXIT_REASON_LABEL: Record<string, string> = {
  target: 'Target',
  hard_stop: 'Hard stop',
  structural_stop: 'Structural stop',
  force_flat: 'Force flat',
  other: 'Other',
}

type ExitReasonKind = 'positive' | 'negative' | 'neutral'

function exitReasonKind(reason: string | null | undefined): ExitReasonKind {
  if (reason === 'target') return 'positive'
  if (reason === 'hard_stop') return 'negative'
  return 'neutral'
}

function exitReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—'
  return EXIT_REASON_LABEL[reason] ?? reason
}

function ExitReasonBadge({ reason }: { reason: string | null | undefined }) {
  if (!reason) {
    return <span className="text-muted-foreground font-mono text-[11px]">—</span>
  }
  const kind = exitReasonKind(reason)
  const cls =
    kind === 'positive'
      ? 'border-[var(--positive)]/30 text-[var(--positive)] bg-[var(--positive)]/10'
      : kind === 'negative'
        ? 'border-[var(--negative)]/30 text-[var(--negative)] bg-[var(--negative)]/10'
        : 'border-border text-muted-foreground bg-muted/30'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase whitespace-nowrap',
        cls,
      )}
    >
      {exitReasonLabel(reason)}
    </span>
  )
}

type SideAgg = { count: number; netPnl: number; wins: number; withPnl: number }
type ExitReasonGroup = {
  reason: string | null
  total: SideAgg
  long: SideAgg
  short: SideAgg
}

function emptyAgg(): SideAgg {
  return { count: 0, netPnl: 0, wins: 0, withPnl: 0 }
}

function isShortSide(side: string | null | undefined): boolean {
  return (side ?? '').toLowerCase().startsWith('s')
}

function addToAgg(agg: SideAgg, t: Trade): void {
  agg.count += 1
  // Net = gross pnl − commission − slippage, matching the Trading-costs panel.
  // Treat null commission/slippage as 0 so older trades don't poison the total.
  const net = (t.pnl ?? 0) - (t.commission ?? 0) - (t.slippage ?? 0)
  agg.netPnl += net
  if (t.pnl != null) {
    agg.withPnl += 1
    if (t.pnl > 0) agg.wins += 1
  }
}

function buildExitBreakdown(trades: Trade[]): ExitReasonGroup[] {
  const map = new Map<string | null, ExitReasonGroup>()
  for (const t of trades) {
    const reason = t.exit_reason ?? null
    let g = map.get(reason)
    if (!g) {
      g = { reason, total: emptyAgg(), long: emptyAgg(), short: emptyAgg() }
      map.set(reason, g)
    }
    addToAgg(g.total, t)
    if (isShortSide(t.side)) addToAgg(g.short, t)
    else addToAgg(g.long, t)
  }

  // Canonical order first (target → hard_stop → structural_stop → force_flat
  // → other), then any unknown reasons alphabetically, then null last.
  const out: ExitReasonGroup[] = []
  for (const k of EXIT_REASON_ORDER) {
    const g = map.get(k)
    if (g) out.push(g)
  }
  const unknowns: ExitReasonGroup[] = []
  map.forEach((g, k) => {
    if (k == null) return
    if ((EXIT_REASON_ORDER as readonly string[]).includes(k)) return
    unknowns.push(g)
  })
  unknowns.sort((a, b) => String(a.reason).localeCompare(String(b.reason)))
  out.push(...unknowns)
  const nullGroup = map.get(null)
  if (nullGroup) out.push(nullGroup)
  return out
}

function ExitReasonCard({ group }: { group: ExitReasonGroup }) {
  return (
    <div className="rounded border border-border bg-card px-3 py-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <ExitReasonBadge reason={group.reason} />
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {group.total.count} trade{group.total.count === 1 ? '' : 's'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SideAggBlock label="Long" agg={group.long} />
        <SideAggBlock label="Short" agg={group.short} />
      </div>
    </div>
  )
}

function SideAggBlock({ label, agg }: { label: string; agg: SideAgg }) {
  const winRate = agg.withPnl > 0 ? agg.wins / agg.withPnl : null
  const sideClass = label === 'Short' ? 'text-[var(--negative)]' : 'text-[var(--positive)]'
  return (
    <div className="rounded border border-border bg-muted/20 px-2.5 py-2 space-y-1.5">
      <div className={cn('text-[10px] font-semibold uppercase tracking-widest', sideClass)}>
        {label}
      </div>
      {agg.count === 0 ? (
        <div className="text-xs text-muted-foreground font-mono">—</div>
      ) : (
        <div className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Count</span>
            <span className="text-xs font-mono tabular-nums">{agg.count}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Net</span>
            <span className={cn('text-xs font-mono tabular-nums', pnlClass(agg.netPnl))}>
              {fmtUsd(agg.netPnl, { signed: true })}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Win</span>
            <span className="text-xs font-mono tabular-nums">
              {winRate == null ? '—' : `${(winRate * 100).toFixed(1)}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

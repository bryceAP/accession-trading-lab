import Link from 'next/link'
import { GitCompare } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { EquityChart, type EquityPoint, type TradeMarker } from '../_components/equity-chart'
import { DrawdownChart } from '../_components/drawdown-chart'
import { NotesThread, type Note } from '../_components/notes-thread'
import { TradesTable, type Trade } from '../_components/trades-table'
import { ExitReasonBadge, EXIT_REASON_ORDER } from '../_components/exit-reason'
import { BacktestRowActions } from '../_components/delete-backtest'
import { timeframeLabel } from '../_components/format'
import {
  asNumber,
  betaClass,
  fmtDate,
  fmtDateTime,
  fmtSignedNumber,
  fmtSignedPctRaw,
  fmtUsd,
  formatMetricValue,
  metricKind,
  metricLabel,
  pnlClass,
  relativeTime,
} from '../_components/format'
import {
  buildRunParamBadges,
  parseRunParams,
  RUN_PARAMS_KEY,
  RunParamBadges,
} from '../_components/run-params'
import { buildConfigBadges, ConfigBadges } from '../_components/config-badges'

type Backtest = {
  id: string
  strategy_id: string | null
  strategy_name: string | null
  label: string | null
  instrument: string | null
  timeframe: string | null
  start_date: string | null
  end_date: string | null
  completed_at: string | null
  metrics: Record<string, unknown> | null
  equity_curve: unknown
  config_snapshot: unknown
  archived_at: string | null
  // Optional runner-populated aggregate; falls back to client compute when absent.
  exit_breakdown: unknown
  // ES regression columns (migration 010). Beta/corr are unitless; alpha is
  // a daily decimal return. Populated by the Python runner.
  beta_es: number | null
  alpha_daily: number | null
  corr_es: number | null
}

// Cap matches the /backtests/compare flow (current + 5 = 6 max). If <5 siblings
// exist we take what's available — don't pad with unrelated runs.
const COMPARE_SIBLING_CAP = 5

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
      .select('id, strategy_id, strategy_name, label, instrument, timeframe, start_date, end_date, completed_at, metrics, equity_curve, exit_breakdown, config_snapshot, archived_at, beta_es, alpha_daily, corr_es')
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

  // "Compare similar" — the most-recent non-archived sibling backtests of the
  // same strategy. Match on strategy_id first (preferred); fall back to
  // strategy_name when strategy_id is null on either side. We exclude this
  // backtest itself so the seeded URL has the current run first followed by
  // its peers.
  const siblingMatchedBy: 'strategy_id' | 'strategy_name' | 'none' =
    backtest.strategy_id ? 'strategy_id' :
    backtest.strategy_name ? 'strategy_name' : 'none'

  let siblingIds: string[] = []
  if (siblingMatchedBy !== 'none') {
    let sibQuery = supabase
      .from('backtests')
      .select('id, completed_at')
      .neq('id', params.id)
      .is('archived_at', null)
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(COMPARE_SIBLING_CAP)

    if (siblingMatchedBy === 'strategy_id') {
      sibQuery = sibQuery.eq('strategy_id', backtest.strategy_id!)
    } else {
      sibQuery = sibQuery.eq('strategy_name', backtest.strategy_name!)
    }

    const sibRes = await sibQuery
    if (sibRes.error) {
      console.error('[BacktestDetail siblings]', params.id, sibRes.error)
    } else {
      siblingIds = (sibRes.data ?? []).map((r) => r.id)
    }
  }

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

  // run_params is rendered separately as badges; drop it from the metrics
  // tile grid so the nested object doesn't print as "[object Object]". Rows
  // predating the runner change have no run_params key and pass through.
  const runParams = parseRunParams(backtest.metrics)
  const runParamBadges = buildRunParamBadges(runParams)
  const metricsEntries = Object.entries(metrics).filter(([k]) => k !== RUN_PARAMS_KEY)

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

      {/* ── Archived banner ───────────────────────────────────── */}
      {backtest.archived_at && (
        <div className="rounded border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This backtest is archived (hidden from the default list since{' '}
          <span className="font-mono text-foreground/80">{new Date(backtest.archived_at).toLocaleDateString()}</span>
          ). Use the controls below to restore or delete it.
        </div>
      )}

      {/* ── Header ────────────────────────────────────────────── */}
      <header className="rounded border border-border bg-card px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="space-y-1">
            <h1 className="text-sm font-semibold tracking-tight">
              {backtest.label?.trim() || backtest.strategy_name || params.id}
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
          <div className="flex items-start gap-3">
            <CompareSimilarButton
              currentId={params.id}
              siblingIds={siblingIds}
            />
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
        </div>
        <ConfigBadges
          badges={buildConfigBadges({
            config_snapshot: backtest.config_snapshot,
            label: backtest.label,
            timeframe: backtest.timeframe,
            start_date: backtest.start_date,
            end_date: backtest.end_date,
          })}
        />
        {runParamBadges.length > 0 && (
          <RunParamBadges badges={runParamBadges} />
        )}
      </header>

      {/* ── Metrics ───────────────────────────────────────────── */}
      <section className="rounded border border-border bg-card p-4 space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Metrics
        </h2>
        {metricsEntries.length === 0 ? (
          <div className="text-xs text-muted-foreground">No metrics recorded.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
            {metricsEntries.map(([k, v]) => {
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

      {/* ── ES regression ─────────────────────────────────────── */}
      {(backtest.beta_es != null || backtest.alpha_daily != null || backtest.corr_es != null) && (
        <section className="rounded border border-border bg-card p-4 space-y-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            ES regression
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <CostStat
              label="β (vs ES)"
              value={fmtSignedNumber(backtest.beta_es, 4)}
              cls={betaClass(backtest.beta_es)}
            />
            <CostStat
              label="α (daily)"
              value={fmtSignedPctRaw(backtest.alpha_daily, 4)}
            />
            <CostStat
              label="Corr (vs ES)"
              value={fmtSignedNumber(backtest.corr_es, 4)}
            />
          </div>
        </section>
      )}

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

      {/* ── Exit breakdown ────────────────────────────────────── */}
      {/* Sits above the equity/drawdown charts so the "why did this run
          finish where it did" answer lands first — the curve below is then
          easier to read with the exit mix already in mind. */}
      {exitBreakdown.length > 0 && (
        <section className="rounded border border-border bg-card p-4 space-y-3">
          <div className="space-y-1">
            <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Exit breakdown
            </h2>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Trades grouped by why they exited. Each card shows count, total
              net P&amp;L, and{' '}
              <span className="text-foreground/80">Net +%</span> — the share of
              those trades that ended net-positive after costs.{' '}
              <span className="text-foreground/60">
                (Expect Hard stop near 0% and Target near 100%.)
              </span>
            </p>
          </div>
          {(() => {
            // Mirror the runner's `⚠️ N trade(s) had no attributed reason`
            // log — surface silent attribution gaps where the strategy didn't
            // tag the closing order, so they don't masquerade as a normal
            // "Other" bucket. `reason === null` covers pre-tagging trades.
            const unattributed = exitBreakdown
              .filter((g) => g.reason === 'other' || g.reason == null)
              .reduce((acc, g) => acc + g.total.count, 0)
            const totalCount = exitBreakdown.reduce((acc, g) => acc + g.total.count, 0)
            if (unattributed === 0) return null
            const pct = totalCount > 0 ? (unattributed / totalCount) * 100 : 0
            return (
              <div className="rounded border border-[var(--negative)]/30 bg-[var(--negative)]/5 px-3 py-2 text-[11px] text-foreground/80">
                <span className="font-mono tabular-nums text-[var(--negative)]">
                  {unattributed.toLocaleString()}
                </span>{' '}
                of{' '}
                <span className="font-mono tabular-nums">{totalCount.toLocaleString()}</span>{' '}
                trade{unattributed === 1 ? '' : 's'} ({pct.toFixed(1)}%) exited
                without an attributed reason — the strategy did not tag the
                closing order. Treat the Other bucket stats with caution.
              </div>
            )
          })()}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {exitBreakdown.map((g) => (
              <ExitReasonCard key={g.reason} group={g} />
            ))}
          </div>
        </section>
      )}

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

      {/* ── Controls ──────────────────────────────────────────── */}
      <section className="rounded border border-border bg-card p-4 space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Controls
        </h2>
        <div className="flex flex-wrap items-center gap-3 justify-end">
          <BacktestRowActions
            backtestId={params.id}
            backtestLabel={backtest.label?.trim() || `${backtest.strategy_name ?? 'Untitled strategy'} · ${timeframeLabel(backtest.timeframe)}`}
            archivedAt={backtest.archived_at}
          />
        </div>
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

function CompareSimilarButton({
  currentId,
  siblingIds,
}: {
  currentId: string
  siblingIds: string[]
}) {
  const enabled = siblingIds.length > 0
  // Current first so the compare modal treats it as the reference line.
  const href = `/backtests/compare?ids=${[currentId, ...siblingIds].join(',')}`
  const tooltip = enabled
    ? `Compare this run with the ${siblingIds.length} most-recent sibling${siblingIds.length === 1 ? '' : 's'} of the same strategy.`
    : 'No other completed backtests for this strategy.'
  const sharedCls =
    'inline-flex items-center gap-1.5 h-7 rounded border px-2.5 text-xs transition-colors'
  if (!enabled) {
    return (
      <span
        title={tooltip}
        className={cn(sharedCls, 'border-border bg-card text-muted-foreground/70 cursor-not-allowed')}
        aria-disabled="true"
      >
        <GitCompare className="h-3.5 w-3.5" />
        Compare similar
      </span>
    )
  }
  return (
    <Link
      href={href}
      title={tooltip}
      className={cn(
        sharedCls,
        'border-foreground/30 bg-foreground/10 text-foreground hover:bg-foreground/20',
      )}
    >
      <GitCompare className="h-3.5 w-3.5" />
      Compare similar
      <span className="font-mono tabular-nums text-muted-foreground">
        ({siblingIds.length})
      </span>
    </Link>
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
  // Win/loss is decided on NET PnL — matches the runner's own [exit-reason
  // BREAKDOWN] log, which counts wins when (gross − commission − slippage) > 0.
  // Using gross here would silently over-count wins on tight-margin strategies.
  if (t.pnl != null) {
    agg.withPnl += 1
    if (net > 0) agg.wins += 1
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
          <div
            className="flex items-baseline justify-between gap-2"
            title="Share of these exits that ended net-positive after costs"
          >
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Net +%</span>
            <span className="text-xs font-mono tabular-nums">
              {winRate == null ? '—' : `${(winRate * 100).toFixed(1)}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

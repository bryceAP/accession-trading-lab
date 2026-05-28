import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { EquityChart, type EquityPoint, type TradeMarker } from '../_components/equity-chart'
import { DrawdownChart } from '../_components/drawdown-chart'
import { NotesThread, type Note } from '../_components/notes-thread'
import {
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtUsd,
  formatMetricValue,
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
}

type Trade = {
  id: string | number
  entry_ts: string | null
  exit_ts: string | null
  side: string | null
  entry_price: number | null
  exit_price: number | null
  qty: number | null
  pnl: number | null
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

export default async function BacktestDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()

  const [btRes, tradesRes, notesRes] = await Promise.all([
    supabase
      .from('backtests')
      .select('id, strategy_name, instrument, timeframe, start_date, end_date, completed_at, metrics, equity_curve')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('trades')
      .select('id, entry_ts, exit_ts, side, entry_price, exit_price, qty, pnl')
      .eq('backtest_id', params.id)
      .order('entry_ts', { ascending: true }),
    supabase
      .from('notes')
      .select('id, author, body, created_at')
      .eq('target_type', 'backtest')
      .eq('target_id', params.id)
      .order('created_at', { ascending: false }),
  ])

  const backtest = btRes.data as Backtest | null
  const trades = (tradesRes.data ?? []) as Trade[]
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

  const equityCurve = normalizeEquityCurve(backtest.equity_curve)
  const tradeMarkers = tradesToMarkers(trades)
  const completed = backtest.completed_at ? new Date(backtest.completed_at) : null
  const metrics = backtest.metrics ?? {}

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
            {equityCurve.length.toLocaleString()} pts · {tradeMarkers.length} trade{tradeMarkers.length === 1 ? '' : 's'}
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
            {Object.entries(metrics).map(([k, v]) => (
              <div key={k} className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{metricLabel(k)}</div>
                <div className={cn(
                  'font-mono tabular-nums text-sm',
                  typeof v === 'number' && (k.toLowerCase().includes('pnl') || k.toLowerCase().includes('profit')) && pnlClass(v),
                )}>
                  {formatMetricValue(k, v)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Price chart placeholder ───────────────────────────── */}
      <section className="rounded border border-border border-dashed bg-card/50 p-6 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Price chart
        </div>
        <div className="text-xs text-muted-foreground">
          Price chart with trade annotations — coming soon.
        </div>
      </section>

      {/* ── Trades table ──────────────────────────────────────── */}
      <section className="rounded border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Trades
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {trades.length}
          </span>
        </div>
        <TradesTable trades={trades} />
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
                  {t.qty != null ? t.qty.toLocaleString('en-US') : '—'}
                </td>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', pnlClass(t.pnl))}>
                  {t.pnl == null ? '—' : fmtUsd(t.pnl, { signed: true })}
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

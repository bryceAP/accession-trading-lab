'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  fmtDate,
  fmtInt,
  fmtNumber,
  fmtPct,
  fmtUsd,
  pickMetric,
  pnlClass,
} from '../../_components/format'
import {
  buildConfigBadges,
  ConfigBadges,
  parseConfigSnapshot,
} from '../../_components/config-badges'
import { strategyColor } from '@/lib/strategy-color'
import { strategyLabel, type StrategyNameInfo } from '@/lib/strategy-names'
import { StrategyDot } from '@/components/strategy-label'

export type CompareBacktest = {
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
  config_snapshot: unknown
  archived_at: string | null
  net_pnl: number | null
  max_drawdown: number | null
  win_rate: number | null
  sharpe: number | null
  profit_factor: number | null
  trades_count: number | null
}

type CurveState = unknown | 'loading' | 'error'

const MAX_SELECTION = 6

type NormalizedPoint = { ts: number; equity: number }

function normalizeCurve(raw: unknown): NormalizedPoint[] {
  if (!Array.isArray(raw)) return []
  const out: NormalizedPoint[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const obj = p as Record<string, unknown>
    const tsRaw = obj.ts ?? obj.timestamp ?? obj.time ?? obj.t ?? obj.date
    const equityRaw = obj.equity ?? obj.value ?? obj.v ?? obj.balance
    let ts: number | null = null
    if (typeof tsRaw === 'number') ts = tsRaw
    else if (typeof tsRaw === 'string') {
      const n = new Date(tsRaw).getTime()
      ts = Number.isNaN(n) ? null : n
    }
    const equity = typeof equityRaw === 'number' ? equityRaw : null
    if (ts != null && equity != null && Number.isFinite(equity)) {
      out.push({ ts, equity })
    }
  }
  out.sort((a, b) => a.ts - b.ts)
  return out
}

function relativeDay(p: NormalizedPoint, t0: number): number {
  return (p.ts - t0) / 86_400_000
}

function interpolate(points: { x: number; y: number }[], target: number): number | null {
  if (points.length === 0) return null
  if (target < points[0].x) return null
  if (target > points[points.length - 1].x) return null
  let lo = 0
  let hi = points.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].x <= target) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  if (b.x === a.x) return a.y
  const t = (target - a.x) / (b.x - a.x)
  return a.y + t * (b.y - a.y)
}

type Series = {
  id: string
  name: string
  color: string
  relative: { x: number; y: number }[]
}

function buildSeries(
  runs: CompareBacktest[],
  curves: Map<string, CurveState>,
): Series[] {
  return runs.map((r) => {
    // Deterministic per-strategy hue. Two runs of the same strategy share a
    // color by design — the legend + tooltip disambiguate by label.
    const color = strategyColor(r.strategy_name)
    const cached = curves.get(r.id)
    const raw = cached === 'loading' || cached === 'error' ? null : cached
    const curve = normalizeCurve(raw)
    if (curve.length === 0) {
      return { id: r.id, name: runLabel(r), color, relative: [] }
    }
    const t0 = curve[0].ts
    const e0 = curve[0].equity
    return {
      id: r.id,
      name: runLabel(r),
      color,
      relative: curve.map((p) => ({ x: relativeDay(p, t0), y: p.equity - e0 })),
    }
  })
}

type MergedPoint = { x: number } & Record<string, number | null>

function mergeSeries(series: Series[]): MergedPoint[] {
  const xs = new Set<number>()
  for (const s of series) for (const p of s.relative) xs.add(p.x)
  const sortedX = Array.from(xs).sort((a, b) => a - b)
  return sortedX.map((x) => {
    const point: MergedPoint = { x }
    for (const s of series) point[s.id] = interpolate(s.relative, x)
    return point
  })
}

function runLabel(r: CompareBacktest): string {
  if (r.label && r.label.trim()) return r.label.trim()
  if (r.strategy_name && r.strategy_name.trim()) return r.strategy_name.trim()
  return r.id.slice(0, 8)
}

function fmtDayAxis(v: number): string {
  if (v >= 365) return `${(v / 365).toFixed(1)}y`
  if (v >= 30) return `${Math.round(v / 30)}mo`
  return `${Math.round(v)}d`
}

function fmtYAxis(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1000) return `${v < 0 ? '−' : ''}${(abs / 1000).toFixed(0)}k`
  return v.toFixed(0)
}

export function CompareView({
  rows,
  strategyDirectory,
}: {
  rows: CompareBacktest[]
  strategyDirectory?: Record<string, StrategyNameInfo>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const resolveStrategy = useCallback(
    (id: string | null, name: string | null): StrategyNameInfo | null => {
      if (!strategyDirectory) return null
      if (id && strategyDirectory[id]) return strategyDirectory[id]
      if (name && strategyDirectory[name]) return strategyDirectory[name]
      return null
    },
    [strategyDirectory],
  )

  const allIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows])

  const selectedIds = useMemo(() => {
    const raw = searchParams.get('ids') ?? ''
    return raw.split(',').filter((id) => id && allIds.has(id))
  }, [searchParams, allIds])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const setSelection = useCallback(
    (ids: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      if (ids.length === 0) params.delete('ids')
      else params.set('ids', ids.join(','))
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : '?', { scroll: false })
    },
    [router, searchParams],
  )

  const toggle = useCallback(
    (id: string) => {
      if (selectedSet.has(id)) {
        setSelection(selectedIds.filter((x) => x !== id))
      } else {
        if (selectedIds.length >= MAX_SELECTION) return
        setSelection([...selectedIds, id])
      }
    },
    [selectedIds, selectedSet, setSelection],
  )

  const clear = useCallback(() => setSelection([]), [setSelection])

  // Preserve user click order in the selected list.
  const selectedRuns = useMemo(() => {
    const byId = new Map(rows.map((r) => [r.id, r] as const))
    return selectedIds.map((id) => byId.get(id)).filter((r): r is CompareBacktest => r != null)
  }, [rows, selectedIds])

  // Equity curves are fetched lazily — only for the runs the user actually
  // picks — so navigating to /backtests/compare with 100+ runs doesn't drag
  // 100 jsonb blobs over the wire. Cached across toggles so re-selecting a
  // previously-loaded run is instant.
  const [curves, setCurves] = useState<Map<string, CurveState>>(new Map())
  const curvesRef = useRef(curves)
  curvesRef.current = curves

  useEffect(() => {
    const missing = selectedIds.filter((id) => !curvesRef.current.has(id))
    if (missing.length === 0) return

    setCurves((prev) => {
      const next = new Map(prev)
      for (const id of missing) next.set(id, 'loading')
      return next
    })

    const supabase = createClient()
    let cancelled = false
    for (const id of missing) {
      supabase
        .from('backtests')
        .select('equity_curve')
        .eq('id', id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled) return
          setCurves((prev) => {
            const next = new Map(prev)
            next.set(id, error ? 'error' : (data?.equity_curve ?? null))
            return next
          })
        })
    }
    return () => {
      cancelled = true
    }
  }, [selectedIds])

  const series = useMemo(() => buildSeries(selectedRuns, curves), [selectedRuns, curves])
  const mergedData = useMemo(() => mergeSeries(series), [series])
  const hasAnyCurve = series.some((s) => s.relative.length > 0)
  const loadingIds = useMemo(
    () => selectedIds.filter((id) => curves.get(id) === 'loading'),
    [selectedIds, curves],
  )
  const errorIds = useMemo(
    () => selectedIds.filter((id) => curves.get(id) === 'error'),
    [selectedIds, curves],
  )
  const atMax = selectedIds.length >= MAX_SELECTION

  return (
    <div className="space-y-4">
      <Selector
        rows={rows}
        selectedSet={selectedSet}
        onToggle={toggle}
        onClear={clear}
        selectedCount={selectedIds.length}
        atMax={atMax}
        resolveStrategy={resolveStrategy}
      />

      {selectedRuns.length < 2 ? (
        <div className="rounded border border-border border-dashed bg-card/50 px-4 py-10 text-center">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
            Pick runs to compare
          </div>
          <div className="text-xs text-muted-foreground">
            {selectedRuns.length === 0
              ? 'Select two or more backtests above to overlay equity curves and compare metrics.'
              : 'Select at least one more backtest to start a comparison.'}
          </div>
        </div>
      ) : (
        <>
          <RunsHeader runs={selectedRuns} series={series} resolveStrategy={resolveStrategy} />
          <OverlayChart
            series={series}
            mergedData={mergedData}
            hasAnyCurve={hasAnyCurve}
            loadingCount={loadingIds.length}
            errorCount={errorIds.length}
          />
          <MetricsTable runs={selectedRuns} series={series} resolveStrategy={resolveStrategy} />
          <ConfigDiffTable runs={selectedRuns} series={series} resolveStrategy={resolveStrategy} />
        </>
      )}
    </div>
  )
}

type StrategyResolver = (id: string | null, name: string | null) => StrategyNameInfo | null

function Selector({
  rows,
  selectedSet,
  onToggle,
  onClear,
  selectedCount,
  atMax,
  resolveStrategy,
}: {
  rows: CompareBacktest[]
  selectedSet: Set<string>
  onToggle: (id: string) => void
  onClear: () => void
  selectedCount: number
  atMax: boolean
  resolveStrategy: StrategyResolver
}) {
  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Runs
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {selectedCount} / {MAX_SELECTION} selected
          </span>
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No backtests recorded yet.
        </div>
      ) : (
        <ul className="max-h-[320px] overflow-y-auto divide-y divide-border">
          {rows.map((r) => {
            const checked = selectedSet.has(r.id)
            const disabled = !checked && atMax
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onToggle(r.id)}
                  disabled={disabled}
                  className={cn(
                    'group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                    checked
                      ? 'bg-muted/50 hover:bg-muted/70'
                      : 'hover:bg-muted/40',
                    disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      checked
                        ? 'border-foreground/60 bg-foreground/10 text-foreground'
                        : 'border-border bg-card text-transparent group-hover:border-foreground/30',
                    )}
                    aria-hidden
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="truncate text-foreground/90">{runLabel(r)}</span>
                      <TimeframeBadge value={r.timeframe} />
                    </div>
                    <div className="flex items-baseline gap-x-2 gap-y-0 text-[10px] text-muted-foreground font-mono tabular-nums whitespace-nowrap overflow-hidden">
                      <span className="inline-flex items-center gap-1 truncate">
                        <StrategyDot name={r.strategy_name} size={6} />
                        <span className="truncate">{strategyLabel(resolveStrategy(r.strategy_id, r.strategy_name), r.strategy_name)}</span>
                      </span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>{r.instrument ?? '—'}</span>
                      <span className="text-muted-foreground/40">·</span>
                      <span>
                        {fmtDate(r.start_date)} <span className="text-muted-foreground/40">→</span> {fmtDate(r.end_date)}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function RunsHeader({
  runs,
  series,
  resolveStrategy,
}: {
  runs: CompareBacktest[]
  series: Series[]
  resolveStrategy: StrategyResolver
}) {
  const colorById = new Map(series.map((s) => [s.id, s.color] as const))
  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <header className="border-b border-border bg-muted/30 px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Selected runs
        </h2>
      </header>
      <ul className="divide-y divide-border">
        {runs.map((r) => {
          const badges = buildConfigBadges({
            config_snapshot: r.config_snapshot,
            label: r.label,
            timeframe: r.timeframe,
            start_date: r.start_date,
            end_date: r.end_date,
          })
          const info = resolveStrategy(r.strategy_id, r.strategy_name)
          const stratPrimary = strategyLabel(info, r.strategy_name)
          return (
            <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: colorById.get(r.id) ?? 'var(--chart-1)' }}
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-foreground/90 truncate">{runLabel(r)}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                    <StrategyDot name={r.strategy_name} size={6} />
                    <span title={r.strategy_name ?? undefined}>{stratPrimary}</span>
                  </span>
                </div>
                <ConfigBadges badges={badges} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function OverlayChart({
  series,
  mergedData,
  hasAnyCurve,
  loadingCount,
  errorCount,
}: {
  series: Series[]
  mergedData: MergedPoint[]
  hasAnyCurve: boolean
  loadingCount: number
  errorCount: number
}) {
  return (
    <section className="rounded border border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Equity overlay
        </h2>
        <span className="inline-flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
          {loadingCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              loading {loadingCount}
            </span>
          )}
          {errorCount > 0 && (
            <span className="text-[var(--negative)]">{errorCount} curve failed</span>
          )}
          <span>P&L since each run&apos;s start, plotted by days elapsed</span>
        </span>
      </div>
      {!hasAnyCurve ? (
        <div className="flex h-[260px] items-center justify-center text-xs text-muted-foreground">
          {loadingCount > 0 ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading equity curves…
            </span>
          ) : (
            'None of the selected runs have an equity curve.'
          )}
        </div>
      ) : (
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={mergedData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={fmtDayAxis}
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
              />
              <YAxis
                tickFormatter={fmtYAxis}
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--border)' }}
                width={56}
              />
              <Tooltip content={<OverlayTooltip series={series} />} cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '2 4' }} />
              <Legend content={<OverlayLegend series={series} />} />
              {series.map((s) => (
                <Line
                  key={s.id}
                  type="linear"
                  dataKey={s.id}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  )
}

function OverlayTooltip({
  series,
  active,
  payload,
  label,
}: {
  series: Series[]
  active?: boolean
  payload?: { dataKey: string; value: number | null; color: string }[]
  label?: number
}) {
  if (!active || !payload?.length) return null
  const byId = new Map(series.map((s) => [s.id, s] as const))
  return (
    <div className="rounded border border-border bg-popover px-2.5 py-2 shadow-md text-xs space-y-1.5">
      <div className="text-[10px] text-muted-foreground font-mono">
        {label != null ? `${fmtDayAxis(label)} elapsed` : ''}
      </div>
      <div className="space-y-0.5">
        {payload.map((p) => {
          const s = byId.get(p.dataKey)
          if (!s) return null
          return (
            <div key={p.dataKey} className="flex items-baseline justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 truncate">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="truncate text-foreground/90">{s.name}</span>
              </span>
              <span className={cn('font-mono tabular-nums', pnlClass(p.value))}>
                {p.value == null ? '—' : fmtUsd(p.value, { signed: true })}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OverlayLegend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-2 text-[11px]">
      {series.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
          <span className="text-muted-foreground">{s.name}</span>
        </span>
      ))}
    </div>
  )
}

type Direction = 'higher_better' | 'lower_better' | null

type MetricSpec = {
  key: string
  label: string
  fmt: (v: number | null) => string
  colorize?: 'pnl' | 'negative'
  direction: Direction
}

const METRIC_SPECS: MetricSpec[] = [
  { key: 'net_pnl',       label: 'Net P&L',       fmt: (v) => (v == null ? '—' : fmtUsd(v, { signed: true })),                   colorize: 'pnl',      direction: 'higher_better' },
  { key: 'max_drawdown',  label: 'Max DD %',      fmt: (v) => (v == null ? '—' : v === 0 ? '0%' : fmtPct(v / 100)),               colorize: 'negative', direction: 'lower_better'  },
  { key: 'max_drawdown_usd', label: 'Max DD ($)', fmt: (v) => (v == null ? '—' : v === 0 ? fmtUsd(0) : `−${fmtUsd(v)}`),          colorize: 'negative', direction: 'lower_better'  },
  { key: 'win_rate',      label: 'Win rate',      fmt: (v) => fmtPct(v),                                                          direction: 'higher_better' },
  { key: 'sharpe',        label: 'Sharpe',        fmt: (v) => (v == null ? '—' : fmtNumber(v, 2)),                                direction: 'higher_better' },
  { key: 'profit_factor', label: 'Profit factor', fmt: (v) => (v == null ? '—' : fmtNumber(v, 2)),                                direction: 'higher_better' },
  { key: 'trades_count',  label: 'Trade count',   fmt: (v) => fmtInt(v),                                                          direction: null },
  { key: 'avg_trade',     label: 'Avg trade',     fmt: (v) => (v == null ? '—' : fmtUsd(v, { signed: true })),                    colorize: 'pnl',      direction: 'higher_better' },
  { key: 'avg_win',       label: 'Avg win',       fmt: (v) => (v == null ? '—' : fmtUsd(v, { signed: true })),                    colorize: 'pnl',      direction: 'higher_better' },
  { key: 'avg_loss',      label: 'Avg loss',      fmt: (v) => (v == null ? '—' : fmtUsd(v, { signed: true })),                    colorize: 'pnl',      direction: 'higher_better' },
]

// Net P&L / trades_count → avg trade pnl. Computed here because the backtests
// row doesn't store the average directly. Returns null when there aren't
// enough trades to make the average meaningful.
function avgTrade(run: CompareBacktest): number | null {
  const net = run.net_pnl ?? pickMetric(run.metrics, 'total_pnl')
  const n = run.trades_count ?? pickMetric(run.metrics, 'total_trades')
  if (net == null || n == null || n <= 0) return null
  return net / n
}

function valueFor(run: CompareBacktest, key: string): number | null {
  switch (key) {
    case 'net_pnl':           return run.net_pnl       ?? pickMetric(run.metrics, 'total_pnl')
    case 'win_rate':          return run.win_rate      ?? pickMetric(run.metrics, 'win_rate')
    case 'sharpe':            return run.sharpe        ?? pickMetric(run.metrics, 'sharpe')
    case 'max_drawdown_usd':  return run.max_drawdown
    case 'max_drawdown': {
      // Express max drawdown as a percentage of the run's starting equity.
      // We don't have direct starting equity on the row, but the runner
      // sometimes writes one into metrics; fall back to a $100k baseline so
      // the column always renders a comparable number across runs.
      const dd = run.max_drawdown
      if (dd == null) return null
      const baseline =
        metricNumber(run.metrics, ['starting_equity', 'starting_capital', 'initial_capital']) ?? 100_000
      return baseline > 0 ? (dd / baseline) * 100 : null
    }
    case 'profit_factor':     return run.profit_factor ?? pickMetric(run.metrics, 'profit_factor')
    case 'trades_count':      return run.trades_count  ?? pickMetric(run.metrics, 'total_trades')
    case 'avg_trade':         return avgTrade(run)
    case 'avg_win':           return metricNumber(run.metrics, ['avg_win', 'Avg Winner', 'Average Winner', 'avg_winner'])
    case 'avg_loss':          return metricNumber(run.metrics, ['avg_loss', 'Avg Loser', 'Average Loser', 'avg_loser'])
  }
  return null
}

function metricNumber(
  metrics: Record<string, unknown> | null | undefined,
  keys: string[],
): number | null {
  if (!metrics) return null
  for (const k of keys) {
    const v = metrics[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  // case-insensitive fallback
  const lc = new Map<string, unknown>()
  for (const [k, v] of Object.entries(metrics)) lc.set(k.toLowerCase(), v)
  for (const k of keys) {
    const v = lc.get(k.toLowerCase())
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string') {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function colorClass(spec: MetricSpec, v: number | null): string {
  if (v == null) return ''
  if (spec.colorize === 'pnl') return pnlClass(v)
  if (spec.colorize === 'negative' && v > 0) return 'text-[var(--negative)]'
  return ''
}

type Extremes = { best: number | null; worst: number | null }

function findExtremes(spec: MetricSpec, runs: CompareBacktest[]): Extremes {
  if (spec.direction == null) return { best: null, worst: null }
  const vals = runs
    .map((r) => valueFor(r, spec.key))
    .filter((v): v is number => v != null && Number.isFinite(v))
  if (vals.length < 2) return { best: null, worst: null }
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  if (max === min) return { best: null, worst: null }
  return spec.direction === 'higher_better'
    ? { best: max, worst: min }
    : { best: min, worst: max }
}

function MetricsTable({
  runs,
  series,
  resolveStrategy,
}: {
  runs: CompareBacktest[]
  series: Series[]
  resolveStrategy: StrategyResolver
}) {
  const colorById = new Map(series.map((s) => [s.id, s.color] as const))
  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <header className="flex items-baseline justify-between border-b border-border bg-muted/30 px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Metrics
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {runs.length} runs · best / worst highlighted
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-[180px]">
                Metric
              </th>
              {runs.map((r) => (
                <th key={r.id} className="px-3 py-2 text-right align-top">
                  <RunHeaderCell
                    run={r}
                    color={colorById.get(r.id) ?? 'var(--chart-1)'}
                    resolveStrategy={resolveStrategy}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRIC_SPECS.map((spec) => {
              const ex = findExtremes(spec, runs)
              return (
                <tr key={spec.key} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                    {spec.label}
                  </td>
                  {runs.map((r) => {
                    const v = valueFor(r, spec.key)
                    const isBest = ex.best != null && v === ex.best
                    const isWorst = ex.worst != null && v === ex.worst
                    return (
                      <td
                        key={r.id}
                        className={cn(
                          'px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap',
                          colorClass(spec, v),
                          isBest && 'bg-[var(--positive)]/10 ring-1 ring-inset ring-[var(--positive)]/30',
                          isWorst && 'bg-[var(--negative)]/10 ring-1 ring-inset ring-[var(--negative)]/30',
                        )}
                        title={isBest ? 'best in row' : isWorst ? 'worst in row' : undefined}
                      >
                        {spec.fmt(v)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RunHeaderCell({
  run,
  color,
  resolveStrategy,
}: {
  run: CompareBacktest
  color: string
  resolveStrategy: StrategyResolver
}) {
  const info = resolveStrategy(run.strategy_id, run.strategy_name)
  const stratPrimary = strategyLabel(info, run.strategy_name)
  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/90">
        <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
        <span className="truncate max-w-[200px]">{runLabel(run)}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
        <span title={run.strategy_name ?? undefined}>{stratPrimary}</span>
        <TimeframeBadge value={run.timeframe} />
      </div>
    </div>
  )
}

function TimeframeBadge({ value }: { value: string | null }) {
  if (!value) {
    return <span className="font-mono text-[10px] text-muted-foreground/60">—</span>
  }
  return (
    <span className="inline-flex h-5 items-center rounded border border-border bg-muted/40 px-1.5 font-mono text-[10px] uppercase tracking-wide text-foreground/80">
      {value}
    </span>
  )
}

// ── Config diff table ──────────────────────────────────────────────────────
// Rows = every key the runs touch in their config_snapshot blobs. Identical-
// across-all-runs rows are hidden by default behind a toggle so the user can
// focus on what actually changed between cells.

function ConfigDiffTable({
  runs,
  series,
  resolveStrategy,
}: {
  runs: CompareBacktest[]
  series: Series[]
  resolveStrategy: StrategyResolver
}) {
  const [showIdentical, setShowIdentical] = useState(false)
  const colorById = new Map(series.map((s) => [s.id, s.color] as const))

  // Collect snapshot maps for each run + the union of keys.
  const snapshots = useMemo(() => {
    return runs.map((r) => {
      const snap = parseConfigSnapshot(r.config_snapshot)
      return snap ? (snap as Record<string, unknown>) : {}
    })
  }, [runs])

  const allKeys = useMemo(() => {
    const set = new Set<string>()
    for (const s of snapshots) for (const k of Object.keys(s)) set.add(k)
    return Array.from(set).sort()
  }, [snapshots])

  type DiffRow = { key: string; values: (unknown)[]; identical: boolean }
  const diffRows: DiffRow[] = useMemo(() => {
    return allKeys.map((k) => {
      const values = snapshots.map((s) => (k in s ? s[k] : undefined))
      const ref = JSON.stringify(values[0] ?? null)
      const identical = values.every((v) => JSON.stringify(v ?? null) === ref)
      return { key: k, values, identical }
    })
  }, [allKeys, snapshots])

  const diffOnlyCount = diffRows.filter((r) => !r.identical).length
  const visibleRows = showIdentical ? diffRows : diffRows.filter((r) => !r.identical)

  if (allKeys.length === 0) {
    return (
      <section className="rounded border border-border bg-card overflow-hidden">
        <header className="flex items-baseline justify-between border-b border-border bg-muted/30 px-3 py-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Config diff
          </h2>
        </header>
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          None of the selected runs have a config_snapshot. Older rows may
          predate the snapshot column — those can be backfilled on the
          mes-algo side.
        </div>
      </section>
    )
  }

  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <header className="flex items-baseline justify-between border-b border-border bg-muted/30 px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Config diff
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {diffOnlyCount} of {diffRows.length} keys differ
          </span>
          <label className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showIdentical}
              onChange={(e) => setShowIdentical(e.target.checked)}
              className="h-3 w-3 accent-foreground"
            />
            Show identical configs
          </label>
        </div>
      </header>
      {visibleRows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          All config keys match across the selected runs.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-[200px]">
                  Key
                </th>
                {runs.map((r) => (
                  <th key={r.id} className="px-3 py-2 text-right align-top">
                    <RunHeaderCell
                      run={r}
                      color={colorById.get(r.id) ?? 'var(--chart-1)'}
                      resolveStrategy={resolveStrategy}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.key} className={cn(
                  'border-b border-border last:border-b-0',
                  row.identical && 'opacity-60',
                )}>
                  <td className="px-3 py-1.5 text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                    {row.key}
                  </td>
                  {row.values.map((v, i) => (
                    <td
                      key={runs[i].id}
                      className={cn(
                        'px-3 py-1.5 text-right font-mono tabular-nums whitespace-nowrap break-all',
                        !row.identical && 'text-foreground',
                        row.identical && 'text-muted-foreground',
                      )}
                    >
                      {formatConfigValue(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function formatConfigValue(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) ? v.toString() : v.toString()
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

'use client'

import { useCallback, useMemo } from 'react'
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
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  fmtDate,
  fmtInt,
  fmtNumber,
  fmtPct,
  fmtUsd,
  maxDrawdownFromCurve,
  pickMetric,
  pnlClass,
} from '../../_components/format'

export type CompareBacktest = {
  id: string
  strategy_name: string | null
  label: string | null
  instrument: string | null
  timeframe: string | null
  start_date: string | null
  end_date: string | null
  completed_at: string | null
  metrics: Record<string, unknown> | null
  equity_curve: unknown
}

const MAX_SELECTION = 5
const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

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

function buildSeries(runs: CompareBacktest[]): Series[] {
  return runs.map((r, i) => {
    const curve = normalizeCurve(r.equity_curve)
    if (curve.length === 0) {
      return { id: r.id, name: runLabel(r), color: SERIES_COLORS[i % SERIES_COLORS.length], relative: [] }
    }
    const t0 = curve[0].ts
    const e0 = curve[0].equity
    return {
      id: r.id,
      name: runLabel(r),
      color: SERIES_COLORS[i % SERIES_COLORS.length],
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

export function CompareView({ rows }: { rows: CompareBacktest[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()

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

  const series = useMemo(() => buildSeries(selectedRuns), [selectedRuns])
  const mergedData = useMemo(() => mergeSeries(series), [series])
  const hasAnyCurve = series.some((s) => s.relative.length > 0)
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
          <OverlayChart series={series} mergedData={mergedData} hasAnyCurve={hasAnyCurve} />
          <MetricsTable runs={selectedRuns} series={series} />
        </>
      )}
    </div>
  )
}

function Selector({
  rows,
  selectedSet,
  onToggle,
  onClear,
  selectedCount,
  atMax,
}: {
  rows: CompareBacktest[]
  selectedSet: Set<string>
  onToggle: (id: string) => void
  onClear: () => void
  selectedCount: number
  atMax: boolean
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
                      <span className="truncate">{r.strategy_name ?? '—'}</span>
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

function OverlayChart({
  series,
  mergedData,
  hasAnyCurve,
}: {
  series: Series[]
  mergedData: MergedPoint[]
  hasAnyCurve: boolean
}) {
  return (
    <section className="rounded border border-border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Equity overlay
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono">
          P&L since each run&apos;s start, plotted by days elapsed
        </span>
      </div>
      {!hasAnyCurve ? (
        <div className="flex h-[260px] items-center justify-center text-xs text-muted-foreground">
          None of the selected runs have an equity curve.
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

type MetricSpec = {
  key: string
  label: string
  fmt: (v: number | null) => string
  colorize?: 'pnl' | 'negative'
}

const METRIC_SPECS: MetricSpec[] = [
  { key: 'total_pnl',     label: 'Net P&L',       fmt: (v) => (v == null ? '—' : fmtUsd(v, { signed: true })), colorize: 'pnl' },
  { key: 'win_rate',      label: 'Win rate',      fmt: (v) => fmtPct(v) },
  { key: 'sharpe',        label: 'Sharpe',        fmt: (v) => (v == null ? '—' : fmtNumber(v, 2)) },
  { key: 'max_drawdown',  label: 'Max drawdown',  fmt: (v) => (v == null ? '—' : v === 0 ? fmtUsd(0) : `−${fmtUsd(v)}`), colorize: 'negative' },
  { key: 'profit_factor', label: 'Profit factor', fmt: (v) => (v == null ? '—' : fmtNumber(v, 2)) },
  { key: 'total_trades',  label: 'Trades',        fmt: (v) => fmtInt(v) },
]

function valueFor(run: CompareBacktest, key: string): number | null {
  if (key === 'max_drawdown') return maxDrawdownFromCurve(run.equity_curve)
  return pickMetric(run.metrics, key as Parameters<typeof pickMetric>[1])
}

function colorClass(spec: MetricSpec, v: number | null): string {
  if (v == null) return ''
  if (spec.colorize === 'pnl') return pnlClass(v)
  if (spec.colorize === 'negative' && v > 0) return 'text-[var(--negative)]'
  return ''
}

function MetricsTable({ runs, series }: { runs: CompareBacktest[]; series: Series[] }) {
  const colorById = new Map(series.map((s) => [s.id, s.color] as const))
  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <header className="flex items-baseline justify-between border-b border-border bg-muted/30 px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Metrics
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {runs.length} runs
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
                  <RunHeaderCell run={r} color={colorById.get(r.id) ?? 'var(--chart-1)'} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRIC_SPECS.map((spec) => (
              <tr key={spec.key} className="border-b border-border last:border-b-0">
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  {spec.label}
                </td>
                {runs.map((r) => {
                  const v = valueFor(r, spec.key)
                  return (
                    <td
                      key={r.id}
                      className={cn(
                        'px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap',
                        colorClass(spec, v),
                      )}
                    >
                      {spec.fmt(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RunHeaderCell({ run, color }: { run: CompareBacktest; color: string }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground/90">
        <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
        <span className="truncate max-w-[200px]">{runLabel(run)}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
        <span>{run.strategy_name ?? '—'}</span>
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

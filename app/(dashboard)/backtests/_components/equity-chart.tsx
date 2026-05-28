'use client'

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { fmtUsd } from './format'

export type EquityPoint = { ts: string | number; equity: number }

export type TradeMarker = {
  exit_ts: string | number
  pnl: number
  side: string | null
  entry_price: number | null
  exit_price: number | null
  entry_ts: string | null
}

type MergedPoint = {
  ts: number
  equity: number
  marker?: TradeMarker
}

function toMs(v: string | number): number {
  if (typeof v === 'number') return v
  const d = new Date(v).getTime()
  return Number.isNaN(d) ? 0 : d
}

function interpolateEquity(curve: { ts: number; equity: number }[], targetTs: number): number | null {
  if (curve.length === 0) return null
  if (targetTs <= curve[0].ts) return curve[0].equity
  if (targetTs >= curve[curve.length - 1].ts) return curve[curve.length - 1].equity
  // Binary search for the bracketing pair.
  let lo = 0
  let hi = curve.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (curve[mid].ts <= targetTs) lo = mid
    else hi = mid
  }
  const a = curve[lo]
  const b = curve[hi]
  if (b.ts === a.ts) return a.equity
  const t = (targetTs - a.ts) / (b.ts - a.ts)
  return a.equity + t * (b.equity - a.equity)
}

function mergeData(curve: EquityPoint[], trades: TradeMarker[]): MergedPoint[] {
  const sortedCurve = curve
    .map((p) => ({ ts: toMs(p.ts), equity: Number(p.equity) }))
    .filter((p) => p.ts > 0 && Number.isFinite(p.equity))
    .sort((a, b) => a.ts - b.ts)

  const points: MergedPoint[] = sortedCurve.map((p) => ({ ts: p.ts, equity: p.equity }))

  for (const t of trades) {
    const ts = toMs(t.exit_ts)
    if (!ts) continue
    const equity = interpolateEquity(sortedCurve, ts)
    if (equity == null) continue
    points.push({ ts, equity, marker: t })
  }

  points.sort((a, b) => a.ts - b.ts)
  return points
}

function fmtDateAxis(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
}

function fmtDateTooltip(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function fmtYAxis(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}k`
  return v.toFixed(0)
}

function ChartTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload: MergedPoint }[]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded border border-border bg-popover px-2.5 py-2 shadow-md text-xs">
      <div className="text-[10px] text-muted-foreground font-mono mb-1">{fmtDateTooltip(p.ts)}</div>
      <div className="font-mono tabular-nums">
        Equity <span className="ml-2 text-foreground">{fmtUsd(p.equity)}</span>
      </div>
      {p.marker && (
        <div className="mt-2 pt-2 border-t border-border space-y-0.5 text-[11px]">
          <div className="font-semibold text-[10px] uppercase tracking-widest text-muted-foreground">Trade exit</div>
          <Row label="Side" value={p.marker.side ?? '—'} />
          <Row label="Entry" value={p.marker.entry_price != null ? fmtUsd(p.marker.entry_price) : '—'} />
          <Row label="Exit" value={p.marker.exit_price != null ? fmtUsd(p.marker.exit_price) : '—'} />
          <Row
            label="P&L"
            value={fmtUsd(p.marker.pnl, { signed: true })}
            cls={p.marker.pnl >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}
          />
        </div>
      )}
    </div>
  )
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${cls ?? ''}`}>{value}</span>
    </div>
  )
}

type DotProps = {
  cx?: number
  cy?: number
  payload?: MergedPoint
  index?: number
}

function MarkerDot(props: DotProps) {
  const { cx, cy, payload, index } = props
  if (cx == null || cy == null || !payload?.marker) {
    return <g key={`empty-${index ?? Math.random()}`} />
  }
  const color = payload.marker.pnl >= 0 ? 'var(--positive)' : 'var(--negative)'
  return (
    <circle
      key={`mk-${payload.ts}-${index ?? 0}`}
      cx={cx}
      cy={cy}
      r={3.5}
      fill={color}
      stroke="var(--background)"
      strokeWidth={1}
    />
  )
}

export function EquityChart({
  curve,
  trades,
}: {
  curve: EquityPoint[]
  trades: TradeMarker[]
}) {
  const data = mergeData(curve, trades)

  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-xs text-muted-foreground">
        No equity curve data.
      </div>
    )
  }

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            scale="time"
            tickFormatter={fmtDateAxis}
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
            width={48}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '2 4' }}
          />
          <Line
            type="linear"
            dataKey="equity"
            stroke="var(--chart-1)"
            strokeWidth={1.5}
            isAnimationActive={false}
            dot={MarkerDot as never}
            activeDot={{ r: 4, fill: 'var(--chart-1)', stroke: 'var(--background)', strokeWidth: 1 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

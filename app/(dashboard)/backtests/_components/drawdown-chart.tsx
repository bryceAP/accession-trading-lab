'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { EquityPoint } from './equity-chart'
import { fmtPct, fmtUsd } from './format'
import { fmtChartDateET, fmtChartTimeET } from '@/lib/format'

function toMs(v: string | number): number {
  if (typeof v === 'number') return v
  const d = new Date(v).getTime()
  return Number.isNaN(d) ? 0 : d
}

type DdPoint = { ts: number; drawdown: number; ddPct: number; peak: number; equity: number }

function buildDrawdown(curve: EquityPoint[]): DdPoint[] {
  const sorted = curve
    .map((p) => ({ ts: toMs(p.ts), equity: Number(p.equity) }))
    .filter((p) => p.ts > 0 && Number.isFinite(p.equity))
    .sort((a, b) => a.ts - b.ts)

  let peak = -Infinity
  return sorted.map((p) => {
    if (p.equity > peak) peak = p.equity
    const drawdown = p.equity - peak // ≤ 0
    const ddPct = peak !== 0 ? drawdown / Math.abs(peak) : 0
    return { ts: p.ts, drawdown, ddPct, peak, equity: p.equity }
  })
}

// Render chart timestamps in America/New_York so drawdown peaks line up with
// the ET bar timeline. zzz auto-resolves EDT vs EST per-date.
function fmtDateAxis(ts: number): string {
  return fmtChartDateET(ts)
}

function fmtDateTooltip(ts: number): string {
  return fmtChartTimeET(ts)
}

function fmtYAxis(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}k`
  return v.toFixed(0)
}

function DdTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload: DdPoint }[]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded border border-border bg-popover px-2.5 py-2 shadow-md text-xs space-y-0.5">
      <div className="text-[10px] text-muted-foreground font-mono mb-1">{fmtDateTooltip(p.ts)}</div>
      <Row label="Drawdown" value={fmtUsd(p.drawdown, { signed: true })} cls="text-[var(--negative)]" />
      <Row label="DD %" value={fmtPct(p.ddPct)} cls="text-[var(--negative)]" />
      <Row label="Peak" value={fmtUsd(p.peak)} />
      <Row label="Equity" value={fmtUsd(p.equity)} />
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

export function DrawdownChart({ curve }: { curve: EquityPoint[] }) {
  const data = buildDrawdown(curve)

  if (data.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">
        No drawdown data.
      </div>
    )
  }

  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <defs>
            <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--negative)" stopOpacity={0.05} />
              <stop offset="100%" stopColor="var(--negative)" stopOpacity={0.35} />
            </linearGradient>
          </defs>
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
            content={<DdTooltip />}
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '2 4' }}
          />
          <Area
            type="linear"
            dataKey="drawdown"
            stroke="var(--negative)"
            strokeWidth={1.25}
            fill="url(#ddGradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

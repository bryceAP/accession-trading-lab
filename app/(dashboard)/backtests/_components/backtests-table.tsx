'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
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
  relativeTime,
} from './format'

export type BacktestRow = {
  id: string
  strategy_name: string | null
  instrument: string | null
  timeframe: string | null
  start_date: string | null
  end_date: string | null
  completed_at: string | null
  metrics: Record<string, unknown> | null
  equity_curve: unknown
  tradeCount: number
}

type SortKey =
  | 'strategy_name'
  | 'instrument'
  | 'timeframe'
  | 'start_date'
  | 'total_pnl'
  | 'win_rate'
  | 'sharpe'
  | 'max_drawdown'
  | 'total_trades'
  | 'completed_at'

type SortDir = 'asc' | 'desc'

type Derived = {
  row: BacktestRow
  total_pnl: number | null
  win_rate: number | null
  sharpe: number | null
  max_drawdown: number | null
  total_trades: number | null
}

function derive(row: BacktestRow): Derived {
  // Trade count: prefer the actual count from the trades table (the same
  // source the detail page uses to render the trades section). Fall back
  // to whatever the metrics jsonb happens to expose if no trade rows are
  // recorded for this backtest.
  const fromTrades = row.tradeCount
  const fromMetric = pickMetric(row.metrics, 'total_trades')
  const total_trades = fromTrades > 0 ? fromTrades : fromMetric

  return {
    row,
    total_pnl: pickMetric(row.metrics, 'total_pnl'),
    win_rate: pickMetric(row.metrics, 'win_rate'),
    sharpe: pickMetric(row.metrics, 'sharpe'),
    // Max DD is not in metrics — compute from equity_curve. Stored as
    // a positive magnitude ($); rendered with a leading minus.
    max_drawdown: maxDrawdownFromCurve(row.equity_curve),
    total_trades,
  }
}

function cmp(a: unknown, b: unknown): number {
  const aN = a == null
  const bN = b == null
  if (aN && bN) return 0
  if (aN) return 1
  if (bN) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function getSortValue(d: Derived, key: SortKey): unknown {
  switch (key) {
    case 'strategy_name': return d.row.strategy_name
    case 'instrument': return d.row.instrument
    case 'timeframe': return d.row.timeframe
    case 'start_date': return d.row.start_date
    case 'completed_at': return d.row.completed_at
    case 'total_pnl': return d.total_pnl
    case 'win_rate': return d.win_rate
    case 'sharpe': return d.sharpe
    case 'max_drawdown': return d.max_drawdown
    case 'total_trades': return d.total_trades
  }
}

export function BacktestsTable({ rows }: { rows: BacktestRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('completed_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [strategyFilter, setStrategyFilter] = useState<string>('')
  const [instrumentFilter, setInstrumentFilter] = useState<string>('')

  const derived = useMemo(() => rows.map(derive), [rows])

  const strategies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.strategy_name).filter(Boolean) as string[])).sort(),
    [rows],
  )
  const instruments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.instrument).filter(Boolean) as string[])).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    return derived.filter((d) => {
      if (strategyFilter && d.row.strategy_name !== strategyFilter) return false
      if (instrumentFilter && d.row.instrument !== instrumentFilter) return false
      return true
    })
  }, [derived, strategyFilter, instrumentFilter])

  const sorted = useMemo(() => {
    const out = [...filtered]
    out.sort((a, b) => {
      const r = cmp(getSortValue(a, sortKey), getSortValue(b, sortKey))
      return sortDir === 'asc' ? r : -r
    })
    return out
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      // Numeric and date columns default to descending; string columns to ascending.
      const numericOrDate: SortKey[] = [
        'total_pnl',
        'win_rate',
        'sharpe',
        'max_drawdown',
        'total_trades',
        'completed_at',
        'start_date',
      ]
      setSortDir(numericOrDate.includes(key) ? 'desc' : 'asc')
    }
  }

  return (
    <div className="space-y-3">
      {/* ── Filters ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Strategy"
          value={strategyFilter}
          onChange={setStrategyFilter}
          options={strategies}
        />
        <FilterSelect
          label="Instrument"
          value={instrumentFilter}
          onChange={setInstrumentFilter}
          options={instruments}
        />
        {(strategyFilter || instrumentFilter) && (
          <button
            type="button"
            onClick={() => { setStrategyFilter(''); setInstrumentFilter('') }}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-[10px] text-muted-foreground font-mono tabular-nums">
          {sorted.length} of {rows.length}
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="rounded border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <Th label="Strategy"   k="strategy_name"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <Th label="Instrument" k="instrument"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <Th label="TF"         k="timeframe"      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <Th label="Date range" k="start_date"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                <Th label="Total P&L"  k="total_pnl"      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="Win rate"   k="win_rate"       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="Sharpe"     k="sharpe"         sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="Max DD"     k="max_drawdown"   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="Trades"     k="total_trades"   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
                <Th label="Completed"  k="completed_at"   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {rows.length === 0 ? 'No backtests recorded yet.' : 'No backtests match the current filters.'}
                  </td>
                </tr>
              ) : (
                sorted.map((d) => (
                  <BodyRow key={d.row.id} d={d} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function BodyRow({ d }: { d: Derived }) {
  const { row } = d
  const completed = row.completed_at ? new Date(row.completed_at) : null
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
      <td className="px-3 py-2">
        <Link
          href={`/backtests/${row.id}`}
          className="hover:text-foreground text-foreground/90 hover:underline underline-offset-2"
        >
          {row.strategy_name ?? '—'}
        </Link>
      </td>
      <td className="px-3 py-2 font-mono text-muted-foreground">{row.instrument ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-muted-foreground">{row.timeframe ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
        {fmtDate(row.start_date)} <span className="text-muted-foreground/40">→</span> {fmtDate(row.end_date)}
      </td>
      <td className={cn('px-3 py-2 text-right font-mono tabular-nums', pnlClass(d.total_pnl))}>
        {d.total_pnl == null ? '—' : fmtUsd(d.total_pnl, { signed: true })}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(d.win_rate)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{d.sharpe == null ? '—' : fmtNumber(d.sharpe, 2)}</td>
      <td className={cn('px-3 py-2 text-right font-mono tabular-nums', d.max_drawdown != null && d.max_drawdown > 0 && 'text-[var(--negative)]')}>
        {d.max_drawdown == null ? '—' : d.max_drawdown === 0 ? fmtUsd(0) : `−${fmtUsd(d.max_drawdown)}`}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtInt(d.total_trades)}</td>
      <td
        className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap"
        title={row.completed_at ?? undefined}
      >
        {completed ? relativeTime(completed) : '—'}
      </td>
    </tr>
  )
}

function Th({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sortKey === k
  const Icon = !active ? ChevronsUpDown : sortDir === 'asc' ? ChevronUp : ChevronDown
  return (
    <th
      className={cn(
        'px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground transition-colors',
          align === 'right' && 'flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        <span>{label}</span>
        <Icon className={cn('h-3 w-3', !active && 'opacity-40')} />
      </button>
    </th>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="uppercase tracking-widest">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded border border-border bg-card px-2 text-xs text-foreground font-mono focus:outline-none focus:border-ring"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

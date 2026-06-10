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
  // Runner-populated summary columns. The list reads these directly so it
  // doesn't have to download equity_curve jsonb or HEAD-count trades per row.
  // Older rows where the runner hasn't backfilled fall through to metrics.
  net_pnl: number | null
  max_drawdown: number | null
  win_rate: number | null
  sharpe: number | null
  trades_count: number | null
}

type SortKey =
  | 'instrument'
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

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '1d'] as const
type Timeframe = (typeof TIMEFRAMES)[number]
type TimeframeFilter = Timeframe | 'all'
const UNNAMED_STRATEGY = '— Unnamed —'

function derive(row: BacktestRow): Derived {
  // Prefer the runner's typed summary columns. Fall back to fuzzy metrics
  // lookups so existing rows that predate the columns still render.
  return {
    row,
    total_pnl:    row.net_pnl       ?? pickMetric(row.metrics, 'total_pnl'),
    win_rate:     row.win_rate      ?? pickMetric(row.metrics, 'win_rate'),
    sharpe:       row.sharpe        ?? pickMetric(row.metrics, 'sharpe'),
    max_drawdown: row.max_drawdown,
    total_trades: row.trades_count  ?? pickMetric(row.metrics, 'total_trades'),
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
    case 'instrument': return d.row.instrument
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
  const [instrumentFilter, setInstrumentFilter] = useState<string>('')
  const [timeframeFilter, setTimeframeFilter] = useState<TimeframeFilter>('all')

  const derived = useMemo(() => rows.map(derive), [rows])

  const instruments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.instrument).filter(Boolean) as string[])).sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    return derived.filter((d) => {
      if (instrumentFilter && d.row.instrument !== instrumentFilter) return false
      if (timeframeFilter !== 'all' && d.row.timeframe !== timeframeFilter) return false
      return true
    })
  }, [derived, instrumentFilter, timeframeFilter])

  const sorted = useMemo(() => {
    const out = [...filtered]
    out.sort((a, b) => {
      const r = cmp(getSortValue(a, sortKey), getSortValue(b, sortKey))
      return sortDir === 'asc' ? r : -r
    })
    return out
  }, [filtered, sortKey, sortDir])

  // Group preserving the sorted order — sections appear in the order their
  // first row would, so sorting by completed_at desc floats the most-recently-
  // active strategy to the top.
  const grouped = useMemo(() => {
    const map = new Map<string, Derived[]>()
    for (const d of sorted) {
      const key = d.row.strategy_name ?? UNNAMED_STRATEGY
      let arr = map.get(key)
      if (!arr) {
        arr = []
        map.set(key, arr)
      }
      arr.push(d)
    }
    return Array.from(map.entries())
  }, [sorted])

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

  const filtersDirty = instrumentFilter !== '' || timeframeFilter !== 'all'

  return (
    <div className="space-y-3">
      {/* ── Timeframe chips ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Timeframe
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {(['all', ...TIMEFRAMES] as TimeframeFilter[]).map((tf) => (
            <TimeframeChip
              key={tf}
              label={tf === 'all' ? 'All' : tf}
              active={timeframeFilter === tf}
              onClick={() => setTimeframeFilter(tf)}
            />
          ))}
        </div>
      </div>

      {/* ── Other filters ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Instrument"
          value={instrumentFilter}
          onChange={setInstrumentFilter}
          options={instruments}
        />
        {filtersDirty && (
          <button
            type="button"
            onClick={() => { setInstrumentFilter(''); setTimeframeFilter('all') }}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-[10px] text-muted-foreground font-mono tabular-nums">
          {sorted.length} of {rows.length}
        </div>
      </div>

      {/* ── Grouped sections ────────────────────────────────── */}
      {grouped.length === 0 ? (
        <div className="rounded border border-border bg-card px-3 py-6 text-center text-xs text-muted-foreground">
          {rows.length === 0 ? 'No backtests recorded yet.' : 'No backtests match the current filters.'}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([strategy, items]) => (
            <StrategySection
              key={strategy}
              strategy={strategy}
              items={items}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StrategySection({
  strategy,
  items,
  sortKey,
  sortDir,
  onSort,
}: {
  strategy: string
  items: Derived[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
}) {
  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <header className="flex items-baseline justify-between border-b border-border bg-muted/30 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-tight text-foreground">{strategy}</h2>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {items.length} {items.length === 1 ? 'backtest' : 'backtests'}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/10">
              <Th label="Instrument" k="instrument"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Date range" k="start_date"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Total P&L"  k="total_pnl"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Win rate"   k="win_rate"       sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Sharpe"     k="sharpe"         sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Max DD"     k="max_drawdown"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Trades"     k="total_trades"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Completed"  k="completed_at"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <BodyRow key={d.row.id} d={d} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
          className="hover:text-foreground text-foreground/90 hover:underline underline-offset-2 font-mono"
        >
          {row.instrument ?? '—'}
        </Link>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          <TimeframeBadge value={row.timeframe} />
          <span className="font-mono text-muted-foreground tabular-nums">
            {fmtDate(row.start_date)} <span className="text-muted-foreground/40">→</span> {fmtDate(row.end_date)}
          </span>
        </span>
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

function TimeframeChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-7 rounded-full border px-2.5 font-mono text-[11px] uppercase tracking-wide transition-colors',
        active
          ? 'border-foreground/60 bg-foreground/10 text-foreground'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
      )}
    >
      {label}
    </button>
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

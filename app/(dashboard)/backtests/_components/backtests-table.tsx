'use client'

import { useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  fmtDate,
  fmtDateTimeWithSeconds,
  fmtElapsed,
  fmtInt,
  fmtNumber,
  fmtPct,
  fmtUsd,
  pickMetric,
  pnlClass,
} from './format'
import {
  buildRunParamBadges,
  parseRunParams,
  RunParamBadges,
  type RunParamBadge,
  type RunParams,
} from './run-params'

export type BacktestRow = {
  id: string
  strategy_name: string | null
  instrument: string | null
  timeframe: string | null
  start_date: string | null
  end_date: string | null
  completed_at: string | null
  duration_ms: number | null
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
  | 'duration'
  | 'completed_at'

type SortDir = 'asc' | 'desc'

type Derived = {
  row: BacktestRow
  total_pnl: number | null
  win_rate: number | null
  sharpe: number | null
  max_drawdown: number | null
  total_trades: number | null
  // Parsed once so filtering + rendering don't re-walk the metrics jsonb.
  // Rows where the runner hasn't written run_params yet land at null and
  // skip badge rendering / filters entirely.
  runParams: RunParams | null
  runParamBadges: RunParamBadge[]
}

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '1d'] as const
type Timeframe = (typeof TIMEFRAMES)[number]
type TimeframeFilter = Timeframe | 'all'
type StringFilter = string | 'all'
const UNNAMED_STRATEGY = '— Unnamed —'

function derive(row: BacktestRow): Derived {
  // Prefer the runner's typed summary columns. Fall back to fuzzy metrics
  // lookups so existing rows that predate the columns still render.
  const runParams = parseRunParams(row.metrics)
  return {
    row,
    total_pnl:    row.net_pnl       ?? pickMetric(row.metrics, 'total_pnl'),
    win_rate:     row.win_rate      ?? pickMetric(row.metrics, 'win_rate'),
    sharpe:       row.sharpe        ?? pickMetric(row.metrics, 'sharpe'),
    max_drawdown: row.max_drawdown,
    total_trades: row.trades_count  ?? pickMetric(row.metrics, 'total_trades'),
    runParams,
    runParamBadges: buildRunParamBadges(runParams),
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
    case 'duration': return d.row.duration_ms
  }
}

export function BacktestsTable({ rows }: { rows: BacktestRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('completed_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [instrumentFilter, setInstrumentFilter] = useState<string>('')
  const [timeframeFilter, setTimeframeFilter] = useState<TimeframeFilter>('all')
  const [entryModeFilter, setEntryModeFilter] = useState<StringFilter>('all')
  const [fillTfFilter, setFillTfFilter] = useState<StringFilter>('all')

  const derived = useMemo(() => rows.map(derive), [rows])

  const instruments = useMemo(
    () => Array.from(new Set(rows.map((r) => r.instrument).filter(Boolean) as string[])).sort(),
    [rows],
  )

  // Derive entry_mode / fill_tf options from the data so the chip set
  // adapts if the runner introduces new values. Sorted for stability.
  const entryModes = useMemo(() => {
    const set = new Set<string>()
    for (const d of derived) if (d.runParams?.entry_mode) set.add(d.runParams.entry_mode)
    return Array.from(set).sort()
  }, [derived])

  const fillTfs = useMemo(() => {
    const set = new Set<string>()
    for (const d of derived) if (d.runParams?.fill_tf) set.add(d.runParams.fill_tf)
    return Array.from(set).sort()
  }, [derived])

  const filtered = useMemo(() => {
    return derived.filter((d) => {
      if (instrumentFilter && d.row.instrument !== instrumentFilter) return false
      if (timeframeFilter !== 'all' && d.row.timeframe !== timeframeFilter) return false
      // Rows without run_params don't match a specific entry_mode/fill_tf
      // filter — they're filtered out rather than silently included, so
      // the cell-isolation use case stays honest.
      if (entryModeFilter !== 'all' && d.runParams?.entry_mode !== entryModeFilter) return false
      if (fillTfFilter !== 'all' && d.runParams?.fill_tf !== fillTfFilter) return false
      return true
    })
  }, [derived, instrumentFilter, timeframeFilter, entryModeFilter, fillTfFilter])

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
        'duration',
        'completed_at',
        'start_date',
      ]
      setSortDir(numericOrDate.includes(key) ? 'desc' : 'asc')
    }
  }

  const filtersDirty =
    instrumentFilter !== '' ||
    timeframeFilter !== 'all' ||
    entryModeFilter !== 'all' ||
    fillTfFilter !== 'all'

  function clearFilters() {
    setInstrumentFilter('')
    setTimeframeFilter('all')
    setEntryModeFilter('all')
    setFillTfFilter('all')
  }

  return (
    <div className="space-y-3">
      {/* ── Timeframe chips ─────────────────────────────────── */}
      <ChipRow label="Timeframe">
        {(['all', ...TIMEFRAMES] as TimeframeFilter[]).map((tf) => (
          <FilterChip
            key={tf}
            label={tf === 'all' ? 'All' : tf}
            active={timeframeFilter === tf}
            onClick={() => setTimeframeFilter(tf)}
          />
        ))}
      </ChipRow>

      {/* ── Run-param chips ─────────────────────────────────── */}
      {(entryModes.length > 0 || fillTfs.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {entryModes.length > 0 && (
            <ChipRow label="Entry mode">
              <FilterChip
                label="All"
                active={entryModeFilter === 'all'}
                onClick={() => setEntryModeFilter('all')}
              />
              {entryModes.map((m) => (
                <FilterChip
                  key={m}
                  label={m}
                  active={entryModeFilter === m}
                  onClick={() => setEntryModeFilter(m)}
                />
              ))}
            </ChipRow>
          )}
          {fillTfs.length > 0 && (
            <ChipRow label="Fill TF">
              <FilterChip
                label="All"
                active={fillTfFilter === 'all'}
                onClick={() => setFillTfFilter('all')}
              />
              {fillTfs.map((t) => (
                <FilterChip
                  key={t}
                  label={t}
                  active={fillTfFilter === t}
                  onClick={() => setFillTfFilter(t)}
                />
              ))}
            </ChipRow>
          )}
        </div>
      )}

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
            onClick={clearFilters}
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
  const [collapsed, setCollapsed] = useState(false)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className={cn(
          'w-full flex items-baseline justify-between bg-muted/30 px-3 py-2 text-left cursor-pointer hover:bg-muted/50 transition-colors',
          !collapsed && 'border-b border-border',
        )}
      >
        <span className="flex items-center gap-1.5">
          <Chevron className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-semibold tracking-tight text-foreground">{strategy}</span>
        </span>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {items.length} {items.length === 1 ? 'backtest' : 'backtests'}
        </span>
      </button>
      {!collapsed && (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/10">
              <Th label="Backtest"   k="instrument"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Date range" k="start_date"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <Th label="Total P&L"  k="total_pnl"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Win rate"   k="win_rate"       sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Sharpe"     k="sharpe"         sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Max DD"     k="max_drawdown"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Trades"     k="total_trades"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Duration"   k="duration"       sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Ran at"     k="completed_at"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <BodyRow key={d.row.id} d={d} />
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  )
}

function BodyRow({ d }: { d: Derived }) {
  const { row } = d
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
      <td className="px-3 py-2">
        <Link
          href={`/backtests/${row.id}`}
          className="hover:text-foreground text-foreground/90 hover:underline underline-offset-2 font-mono whitespace-nowrap"
        >
          {row.instrument ?? '—'} <span className="text-muted-foreground/40">•</span> {row.timeframe ?? '—'}
        </Link>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-muted-foreground tabular-nums whitespace-nowrap">
            {fmtDate(row.start_date)} <span className="text-muted-foreground/40">→</span> {fmtDate(row.end_date)}
          </span>
          {d.runParamBadges.length > 0 && (
            <RunParamBadges badges={d.runParamBadges} />
          )}
        </div>
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
      <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
        {row.duration_ms != null ? (
          fmtElapsed(row.duration_ms)
        ) : row.completed_at == null ? (
          <span className="text-muted-foreground italic">Running…</span>
        ) : (
          '—'
        )}
      </td>
      <td
        className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap"
        title={row.completed_at ?? undefined}
      >
        {fmtDateTimeWithSeconds(row.completed_at)}
      </td>
    </tr>
  )
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

function FilterChip({
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

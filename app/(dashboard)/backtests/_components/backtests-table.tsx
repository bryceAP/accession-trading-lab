'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  Clock,
  GitCompare,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  betaClass,
  fmtDate,
  fmtDateTimeWithSeconds,
  fmtElapsed,
  fmtInt,
  fmtNumber,
  fmtPct,
  fmtSignedNumber,
  fmtSignedPctRaw,
  fmtUsd,
  pickMetric,
  pnlClass,
} from './format'
import {
  buildConfigBadges,
  ConfigBadges,
  entryModeFacet,
  sessionFacet,
  spanBucket,
  type ConfigBadge,
  type SpanBucket,
} from './config-badges'
import { StrategyLabel } from '@/components/strategy-label'
import { strategyLabel, type StrategyNameInfo } from '@/lib/strategy-names'
import { strategyColor } from '@/lib/strategy-color'
import { BacktestInlineActions } from './delete-backtest'

export type BacktestRow = {
  id: string
  strategy_id: string | null
  strategy_name: string | null
  label: string | null
  instrument: string | null
  timeframe: string | null
  start_date: string | null
  end_date: string | null
  completed_at: string | null
  duration_ms: number | null
  metrics: Record<string, unknown> | null
  config_snapshot: unknown
  archived_at: string | null
  // Runner-populated summary columns. The list reads these directly so it
  // doesn't have to download equity_curve jsonb or HEAD-count trades per row.
  // Older rows where the runner hasn't backfilled fall through to metrics.
  net_pnl: number | null
  gross_pnl: number | null
  max_drawdown: number | null
  win_rate: number | null
  sharpe: number | null
  trades_count: number | null
  // ES regression columns populated by migration 010's backfill. The runner
  // regresses strategy daily returns on ES daily-close returns server-side;
  // the frontend just renders the stored values.
  beta_es: number | null
  alpha_daily: number | null
  corr_es: number | null
}

type SortKey =
  | 'completed_at'
  | 'net_pnl'
  | 'win_rate'
  | 'sharpe'
  | 'beta_es'
  | 'alpha_daily'
  | 'corr_es'
  | 'max_drawdown'
  | 'trades_count'

type SortDir = 'asc' | 'desc'

type Derived = {
  row: BacktestRow
  net_pnl: number | null
  gross_pnl: number | null
  win_rate: number | null
  sharpe: number | null
  beta_es: number | null
  alpha_daily: number | null
  corr_es: number | null
  max_drawdown: number | null
  trades_count: number | null
  configBadges: ConfigBadge[]
  session: 'ny' | 'globex'
  entry_mode: string | null
  span: SpanBucket | null
}

const UNNAMED_STRATEGY = '— Unnamed —'
const MAX_COMPARE = 6
const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: 'completed_at',  label: 'Ran at',     defaultDir: 'desc' },
  { key: 'net_pnl',       label: 'Net P&L',    defaultDir: 'desc' },
  { key: 'win_rate',      label: 'Win rate',   defaultDir: 'desc' },
  { key: 'sharpe',        label: 'Sharpe',     defaultDir: 'desc' },
  { key: 'beta_es',       label: 'β (ES)',     defaultDir: 'asc'  },
  { key: 'alpha_daily',   label: 'α/day',      defaultDir: 'desc' },
  { key: 'corr_es',       label: 'Corr (ES)',  defaultDir: 'asc'  },
  { key: 'max_drawdown',  label: 'Max DD',     defaultDir: 'asc'  },
  { key: 'trades_count',  label: 'Trades',     defaultDir: 'desc' },
]
const SORT_KEYS = new Set<SortKey>(SORT_OPTIONS.map((o) => o.key))

function derive(row: BacktestRow): Derived {
  // Prefer the runner's typed summary columns. Fall back to fuzzy metrics
  // lookups so existing rows that predate the columns still render.
  const input = {
    config_snapshot: row.config_snapshot,
    label: row.label,
    timeframe: row.timeframe,
    start_date: row.start_date,
    end_date: row.end_date,
  }
  // max_drawdown wants USD magnitude. Older runner versions wrote the percent
  // into the typed column, so we prefer metrics.max_drawdown_usd as the
  // source of truth and only fall back to the column for rows that don't
  // have the USD metric available.
  const maxDdUsd = pickMetric(row.metrics, 'max_drawdown') ?? row.max_drawdown
  return {
    row,
    net_pnl:       row.net_pnl       ?? pickMetric(row.metrics, 'total_pnl'),
    gross_pnl:     row.gross_pnl     ?? pickMetric(row.metrics, 'gross_pnl'),
    win_rate:      row.win_rate      ?? pickMetric(row.metrics, 'win_rate'),
    sharpe:        row.sharpe        ?? pickMetric(row.metrics, 'sharpe'),
    // Migration 010 columns — no metrics fallback. Rows that predate the
    // backfill render as '—' rather than guessing from jsonb.
    beta_es:       row.beta_es,
    alpha_daily:   row.alpha_daily,
    corr_es:       row.corr_es,
    max_drawdown:  maxDdUsd,
    trades_count:  row.trades_count  ?? pickMetric(row.metrics, 'total_trades'),
    configBadges:  buildConfigBadges(input),
    session:       sessionFacet(input),
    entry_mode:    entryModeFacet(input),
    span:          spanBucket(row.start_date, row.end_date),
  }
}

// Parse a timeframe string ("1m", "15m", "1h", "4h", "1d", "30s") into minutes
// so dropdowns can sort least → greatest numerically. Bare numbers are read as
// minutes; anything we can't parse sorts to the end via +Infinity.
function timeframeMinutes(tf: string): number {
  const m = tf.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([smhd]?)$/)
  if (!m) return Number.POSITIVE_INFINITY
  const n = Number(m[1])
  switch (m[2]) {
    case 's': return n / 60
    case 'h': return n * 60
    case 'd': return n * 60 * 24
    case 'm':
    case '':  return n
    default:  return Number.POSITIVE_INFINITY
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
    case 'completed_at':  return d.row.completed_at
    case 'net_pnl':       return d.net_pnl
    case 'win_rate':      return d.win_rate
    case 'sharpe':        return d.sharpe
    // Sort beta and corr by absolute value so the "closet long" runs cluster
    // together at one end regardless of sign — what matters is magnitude.
    case 'beta_es':       return d.beta_es == null ? null : Math.abs(d.beta_es)
    case 'alpha_daily':   return d.alpha_daily
    case 'corr_es':       return d.corr_es == null ? null : Math.abs(d.corr_es)
    case 'max_drawdown':  return d.max_drawdown
    case 'trades_count':  return d.trades_count
  }
}

// ── URL-state helpers ───────────────────────────────────────────────────────
// All filters + sort live in the URL so list views are shareable. Each value
// here parses defensively (unknown strategy IDs / timeframes are dropped) so
// hand-edited URLs degrade gracefully instead of throwing.

function parseSet(raw: string | null): Set<string> {
  if (!raw) return new Set()
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

function setOrUndef(s: Set<string>): string | undefined {
  return s.size ? Array.from(s).sort().join(',') : undefined
}

type ParsedQuery = {
  strategies: Set<string>
  timeframes: Set<string>
  session: 'all' | 'ny' | 'globex'
  entryMode: 'all' | string
  span: 'all' | SpanBucket
  labelQ: string
  sortKey: SortKey
  sortDir: SortDir
}

function parseQuery(sp: URLSearchParams): ParsedQuery {
  const sortRaw = sp.get('sort') ?? ''
  const [skRaw, sdRaw] = sortRaw.split(':')
  const sortKey: SortKey = SORT_KEYS.has(skRaw as SortKey) ? (skRaw as SortKey) : 'completed_at'
  const sortDir: SortDir = sdRaw === 'asc' ? 'asc' : 'desc'

  const sessionRaw = sp.get('session') ?? 'all'
  const session: ParsedQuery['session'] =
    sessionRaw === 'ny' || sessionRaw === 'globex' ? sessionRaw : 'all'

  const spanRaw = sp.get('span') ?? 'all'
  const span: ParsedQuery['span'] =
    spanRaw === '5wk' || spanRaw === '1yr' || spanRaw === '4yr' || spanRaw === '10yr' || spanRaw === 'other'
      ? spanRaw
      : 'all'

  return {
    strategies: parseSet(sp.get('strategy')),
    timeframes: parseSet(sp.get('tf')),
    session,
    entryMode: sp.get('mode') ?? 'all',
    span,
    labelQ: sp.get('q') ?? '',
    sortKey,
    sortDir,
  }
}

export function BacktestsTable({
  rows,
  strategyDirectory,
}: {
  rows: BacktestRow[]
  strategyDirectory?: Record<string, StrategyNameInfo>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const q = useMemo(() => parseQuery(new URLSearchParams(searchParams.toString())), [searchParams])

  const resolveStrategy = useCallback(
    (id: string | null, name: string | null): StrategyNameInfo | null => {
      if (!strategyDirectory) return null
      if (id && strategyDirectory[id]) return strategyDirectory[id]
      if (name && strategyDirectory[name]) return strategyDirectory[name]
      return null
    },
    [strategyDirectory],
  )

  const updateQuery = useCallback(
    (patch: Partial<{
      strategies: Set<string>
      timeframes: Set<string>
      session: ParsedQuery['session']
      entryMode: string
      span: ParsedQuery['span']
      labelQ: string
      sortKey: SortKey
      sortDir: SortDir
    }>) => {
      const next = new URLSearchParams(searchParams.toString())
      const apply = (k: string, v: string | undefined) => {
        if (v == null || v === '' ) next.delete(k)
        else next.set(k, v)
      }
      if ('strategies' in patch) apply('strategy', setOrUndef(patch.strategies!))
      if ('timeframes' in patch) apply('tf', setOrUndef(patch.timeframes!))
      if ('session' in patch) apply('session', patch.session === 'all' ? undefined : patch.session)
      if ('entryMode' in patch) apply('mode', patch.entryMode === 'all' ? undefined : patch.entryMode)
      if ('span' in patch) apply('span', patch.span === 'all' ? undefined : patch.span)
      if ('labelQ' in patch) apply('q', patch.labelQ || undefined)
      if ('sortKey' in patch || 'sortDir' in patch) {
        const sk = patch.sortKey ?? q.sortKey
        const sd = patch.sortDir ?? q.sortDir
        const isDefault = sk === 'completed_at' && sd === 'desc'
        apply('sort', isDefault ? undefined : `${sk}:${sd}`)
      }
      const qs = next.toString()
      // Use replace + scroll: false so toggling a chip doesn't blow up the
      // back-button history or scroll to top of the table.
      router.replace(qs ? `?${qs}` : '?', { scroll: false })
    },
    [router, searchParams, q.sortKey, q.sortDir],
  )

  const derived = useMemo(() => rows.map(derive), [rows])

  // Build facet option lists from the un-filtered data so toggling a filter
  // doesn't make valid options vanish from the chooser.
  const strategyOptions = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const d of derived) {
      const id = d.row.strategy_id ?? d.row.strategy_name ?? ''
      const info = resolveStrategy(d.row.strategy_id, d.row.strategy_name)
      const name = strategyLabel(info, d.row.strategy_name ?? UNNAMED_STRATEGY)
      if (id && !m.has(id)) m.set(id, { id, name })
    }
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [derived, resolveStrategy])

  const timeframeOptions = useMemo(() => {
    const set = new Set<string>()
    for (const d of derived) if (d.row.timeframe) set.add(d.row.timeframe)
    return Array.from(set).sort((a, b) => {
      const av = timeframeMinutes(a)
      const bv = timeframeMinutes(b)
      if (av !== bv) return av - bv
      return a.localeCompare(b)
    })
  }, [derived])

  const entryModeOptions = useMemo(() => {
    const set = new Set<string>()
    for (const d of derived) if (d.entry_mode) set.add(d.entry_mode)
    return Array.from(set).sort()
  }, [derived])

  const filtered = useMemo(() => {
    const labelRe = q.labelQ.toLowerCase().trim()
    return derived.filter((d) => {
      if (q.strategies.size) {
        const id = d.row.strategy_id ?? d.row.strategy_name ?? ''
        if (!q.strategies.has(id)) return false
      }
      if (q.timeframes.size) {
        if (!d.row.timeframe || !q.timeframes.has(d.row.timeframe)) return false
      }
      if (q.session !== 'all' && d.session !== q.session) return false
      if (q.entryMode !== 'all' && d.entry_mode !== q.entryMode) return false
      if (q.span !== 'all' && d.span !== q.span) return false
      if (labelRe) {
        const hay = `${d.row.label ?? ''} ${d.row.strategy_name ?? ''}`.toLowerCase()
        if (!hay.includes(labelRe)) return false
      }
      return true
    })
  }, [derived, q])

  const sorted = useMemo(() => {
    const out = [...filtered]
    out.sort((a, b) => {
      const r = cmp(getSortValue(a, q.sortKey), getSortValue(b, q.sortKey))
      return q.sortDir === 'asc' ? r : -r
    })
    return out
  }, [filtered, q.sortKey, q.sortDir])

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

  // "Recent runs" — the 10 most-recently-completed backtests, pulled from the
  // post-filter view so toggling filters scopes it sensibly. The *set* is
  // always the 10 newest by completed_at (that's what makes this section
  // mean "what just finished"), but the rows within respect the active sort
  // so clicking a column header reorders them like every other table.
  const recentRuns = useMemo(() => {
    const completed = filtered.filter((d) => d.row.completed_at)
    completed.sort((a, b) => {
      const ta = a.row.completed_at ? new Date(a.row.completed_at).getTime() : 0
      const tb = b.row.completed_at ? new Date(b.row.completed_at).getTime() : 0
      return tb - ta
    })
    const top = completed.slice(0, 10)
    top.sort((a, b) => {
      const r = cmp(getSortValue(a, q.sortKey), getSortValue(b, q.sortKey))
      return q.sortDir === 'asc' ? r : -r
    })
    return top
  }, [filtered, q.sortKey, q.sortDir])

  function toggleSet(key: 'strategies' | 'timeframes', value: string) {
    const cur = new Set(key === 'strategies' ? q.strategies : q.timeframes)
    if (cur.has(value)) cur.delete(value)
    else cur.add(value)
    updateQuery({ [key]: cur } as Partial<{ strategies: Set<string>; timeframes: Set<string> }>)
  }

  function setSort(k: SortKey) {
    if (q.sortKey === k) {
      updateQuery({ sortDir: q.sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      const def = SORT_OPTIONS.find((o) => o.key === k)?.defaultDir ?? 'desc'
      updateQuery({ sortKey: k, sortDir: def })
    }
  }

  const filtersDirty =
    q.strategies.size > 0 ||
    q.timeframes.size > 0 ||
    q.session !== 'all' ||
    q.entryMode !== 'all' ||
    q.span !== 'all' ||
    q.labelQ !== ''

  function clearFilters() {
    updateQuery({
      strategies: new Set(),
      timeframes: new Set(),
      session: 'all',
      entryMode: 'all',
      span: 'all',
      labelQ: '',
    })
  }

  // ── Multi-select for compare ───────────────────────────────────
  // Selection lives in component state (not URL) so chip-toggling filters
  // doesn't blow it away. We only push selected IDs into the URL when the
  // user clicks "Compare N", which navigates to /backtests/compare?ids=…
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const visibleIds = useMemo(() => new Set(sorted.map((d) => d.row.id)), [sorted])

  function toggleSelected(id: string) {
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
    } else {
      if (next.size >= MAX_COMPARE) return
      next.add(id)
    }
    setSelected(next)
  }
  function clearSelected() {
    setSelected(new Set())
  }

  // Drop selected IDs that filtered out of view so the footer count matches
  // what the user can actually see. (Selection sticks across sort changes
  // and accent-chip toggles but not across full-filter changes.)
  const selectedVisible = useMemo(
    () => Array.from(selected).filter((id) => visibleIds.has(id)),
    [selected, visibleIds],
  )
  const compareHref = `/backtests/compare?ids=${selectedVisible.join(',')}`
  const compareDisabled = selectedVisible.length < 2

  return (
    <div className="space-y-3">
      {/* ── Filter row ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <FacetMulti
          label="Strategy"
          options={strategyOptions.map((s) => ({ value: s.id, label: s.name }))}
          values={q.strategies}
          onToggle={(v) => toggleSet('strategies', v)}
        />
        <FacetMulti
          label="Timeframe"
          options={timeframeOptions.map((t) => ({ value: t, label: t }))}
          values={q.timeframes}
          onToggle={(v) => toggleSet('timeframes', v)}
        />
        <FacetSingle
          label="Session"
          value={q.session}
          options={[
            { value: 'all', label: 'All' },
            { value: 'globex', label: '23/5 Globex' },
            { value: 'ny', label: 'NY hours' },
          ]}
          onChange={(v) => updateQuery({ session: v as ParsedQuery['session'] })}
        />
        {entryModeOptions.length > 0 && (
          <FacetSingle
            label="Entry"
            value={q.entryMode}
            options={[
              { value: 'all', label: 'All' },
              ...entryModeOptions.map((m) => ({ value: m, label: m })),
            ]}
            onChange={(v) => updateQuery({ entryMode: v })}
          />
        )}
        <FacetSingle
          label="Span"
          value={q.span}
          options={[
            { value: 'all', label: 'All' },
            { value: '5wk', label: '5wk' },
            { value: '1yr', label: '1yr' },
            { value: '4yr', label: '4yr' },
            { value: '10yr', label: '10yr' },
            { value: 'other', label: 'Other' },
          ]}
          onChange={(v) => updateQuery({ span: v as ParsedQuery['span'] })}
        />
        <LabelSearch value={q.labelQ} onChange={(v) => updateQuery({ labelQ: v })} />
        <div className="ml-auto flex items-center gap-3">
          <SortControl
            sortKey={q.sortKey}
            sortDir={q.sortDir}
            onChange={(k, d) => updateQuery({ sortKey: k, sortDir: d })}
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
          <div className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {sorted.length} of {rows.length}
          </div>
        </div>
      </div>

      {/* ── Recent runs (past 24h) ──────────────────────────── */}
      {recentRuns.length > 0 && (
        <RecentRunsSection
          items={recentRuns}
          sortKey={q.sortKey}
          sortDir={q.sortDir}
          onSort={setSort}
          selected={selected}
          onToggleSelected={toggleSelected}
          selectionFull={selected.size >= MAX_COMPARE}
          resolveStrategy={resolveStrategy}
        />
      )}

      {/* ── Grouped sections ────────────────────────────────── */}
      {grouped.length === 0 ? (
        <div className="rounded border border-border bg-card px-3 py-6 text-center text-xs text-muted-foreground">
          {rows.length === 0 ? 'No backtests recorded yet.' : 'No backtests match the current filters.'}
        </div>
      ) : (
        <div className={cn('space-y-4', selectedVisible.length > 0 && 'pb-16')}>
          {grouped.map(([strategy, items]) => (
            <StrategySection
              key={strategy}
              strategy={strategy}
              info={resolveStrategy(items[0]?.row.strategy_id ?? null, items[0]?.row.strategy_name ?? null)}
              items={items}
              sortKey={q.sortKey}
              sortDir={q.sortDir}
              onSort={setSort}
              selected={selected}
              onToggleSelected={toggleSelected}
              selectionFull={selected.size >= MAX_COMPARE}
            />
          ))}
        </div>
      )}

      {/* ── Sticky compare footer ──────────────────────────────────── */}
      {selectedVisible.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4 pointer-events-none">
          <div className="pointer-events-auto inline-flex items-center gap-3 rounded border border-border bg-popover px-3 py-2 shadow-xl">
            <span className="text-xs text-muted-foreground">
              <span className="font-mono tabular-nums text-foreground">{selectedVisible.length}</span>
              {' / '}
              <span className="font-mono tabular-nums">{MAX_COMPARE}</span>
              {' selected'}
            </span>
            <Link
              href={compareDisabled ? '#' : compareHref}
              aria-disabled={compareDisabled}
              onClick={(e) => compareDisabled && e.preventDefault()}
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition-colors',
                compareDisabled
                  ? 'border-border bg-muted/40 text-muted-foreground cursor-not-allowed'
                  : 'border-foreground/40 bg-foreground/10 text-foreground hover:bg-foreground/20',
              )}
            >
              <GitCompare className="h-3 w-3" />
              Compare {selectedVisible.length} {selectedVisible.length === 1 ? 'backtest' : 'backtests'}
            </Link>
            <button
              type="button"
              onClick={clearSelected}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Flat-list view of the most-recent runs (past 24h), rendered above the
// per-strategy grouped sections. Reuses the same BodyRow + Th components so
// rows render exactly like inside a strategy section (badges, inline actions,
// sortable columns) — Bryce gets one place to see "what just finished" while
// the strategy index below stays collapsed by default.
function RecentRunsSection({
  items,
  sortKey,
  sortDir,
  onSort,
  selected,
  onToggleSelected,
  selectionFull,
  resolveStrategy,
}: {
  items: Derived[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  selected: Set<string>
  onToggleSelected: (id: string) => void
  selectionFull: boolean
  resolveStrategy: (id: string | null, name: string | null) => StrategyNameInfo | null
}) {
  // Default open — this is the headline section and Bryce will usually want
  // to see the just-finished runs. He can collapse if he wants to scan the
  // strategy index below without the visual weight on top.
  const [collapsed, setCollapsed] = useState(false)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <section className="rounded border border-foreground/20 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className={cn(
          'w-full flex items-center justify-between bg-foreground/[0.04] px-3 py-2 text-left cursor-pointer hover:bg-foreground/[0.07] transition-colors',
          !collapsed && 'border-b border-border',
        )}
      >
        <span className="inline-flex items-center gap-2">
          <Chevron className="h-3 w-3 text-muted-foreground shrink-0" />
          <Clock className="h-3 w-3 text-foreground/70" />
          <span className="text-xs font-semibold tracking-tight text-foreground">
            Recent runs
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            last 10
          </span>
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
              <th className="w-8 px-2 py-2" aria-label="Select" />
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Strategy · Backtest
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Date range
              </th>
              <Th label="Net P&L"  k="net_pnl"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Win rate" k="win_rate"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Sharpe"   k="sharpe"        sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="β (ES)"   k="beta_es"       sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="α/day"    k="alpha_daily"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Corr (ES)" k="corr_es"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Max DD"   k="max_drawdown"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Trades"   k="trades_count"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Duration
              </th>
              <Th label="Ran at"   k="completed_at"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-[80px]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <BodyRow
                key={d.row.id}
                d={d}
                selected={selected.has(d.row.id)}
                disabled={!selected.has(d.row.id) && selectionFull}
                onToggleSelected={onToggleSelected}
                strategyInfo={resolveStrategy(d.row.strategy_id, d.row.strategy_name)}
              />
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  )
}

function StrategySection({
  strategy,
  info,
  items,
  sortKey,
  sortDir,
  onSort,
  selected,
  onToggleSelected,
  selectionFull,
}: {
  strategy: string
  info: StrategyNameInfo | null
  items: Derived[]
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  selected: Set<string>
  onToggleSelected: (id: string) => void
  selectionFull: boolean
}) {
  // Default-collapsed so the page opens as a clean strategy index rather than
  // a wall of rows. Bryce expands the strategy he wants to dig into; the
  // "Recent runs" section above keeps the just-finished runs visible at a glance.
  const [collapsed, setCollapsed] = useState(true)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  const stratNameForColor = info?.name ?? strategy
  const primary = strategyLabel(info, strategy)
  const showSecondary = info?.name && primary !== info.name
  return (
    <section
      className="rounded border border-l-4 border-border bg-card overflow-hidden"
      style={{ borderLeftColor: strategyColor(stratNameForColor) }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className={cn(
          'w-full flex items-center justify-between bg-muted/30 px-3 py-2 text-left cursor-pointer hover:bg-muted/50 transition-colors',
          !collapsed && 'border-b border-border',
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Chevron className="h-3 w-3 text-muted-foreground shrink-0" />
          <StrategyLabel
            info={info}
            fallback={strategy}
            dotSize={10}
            className="text-xs font-semibold tracking-tight text-foreground"
            truncate={false}
          />
          {showSecondary && (
            <span className="text-[10px] font-mono text-muted-foreground truncate">
              {info?.name}
            </span>
          )}
        </span>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
          {items.length} {items.length === 1 ? 'backtest' : 'backtests'}
        </span>
      </button>
      {!collapsed && (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/10">
              <th className="w-8 px-2 py-2" aria-label="Select" />
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Backtest
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Date range
              </th>
              <Th label="Net P&L"  k="net_pnl"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Win rate" k="win_rate"     sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Sharpe"   k="sharpe"        sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="β (ES)"   k="beta_es"       sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="α/day"    k="alpha_daily"   sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Corr (ES)" k="corr_es"      sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Max DD"   k="max_drawdown"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <Th label="Trades"   k="trades_count"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Duration
              </th>
              <Th label="Ran at"   k="completed_at"  sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" />
              <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-widest text-muted-foreground w-[80px]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <BodyRow
                key={d.row.id}
                d={d}
                selected={selected.has(d.row.id)}
                disabled={!selected.has(d.row.id) && selectionFull}
                onToggleSelected={onToggleSelected}
              />
            ))}
          </tbody>
        </table>
      </div>
      )}
    </section>
  )
}

function BodyRow({
  d,
  selected,
  disabled,
  onToggleSelected,
  strategyInfo,
}: {
  d: Derived
  selected: boolean
  disabled: boolean
  onToggleSelected: (id: string) => void
  // When set, render a small strategy label/dot above the backtest label.
  // The grouped strategy sections suppress this (they already render the
  // strategy in their header); the flat "Recent runs" table opts in.
  strategyInfo?: StrategyNameInfo | null
}) {
  const { row } = d
  return (
    <tr className={cn(
      'border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors',
      selected && 'bg-muted/30',
      row.archived_at && 'opacity-60',
    )}>
      <td className="w-8 px-2 py-2">
        <button
          type="button"
          onClick={() => onToggleSelected(row.id)}
          disabled={disabled}
          aria-pressed={selected}
          aria-label={selected ? 'Deselect' : 'Select for comparison'}
          className={cn(
            'inline-flex h-4 w-4 items-center justify-center rounded border transition-colors',
            selected
              ? 'border-foreground/60 bg-foreground/10 text-foreground'
              : 'border-border bg-card text-transparent hover:border-foreground/30',
            disabled && 'opacity-30 cursor-not-allowed',
          )}
        >
          <Check className="h-3 w-3" />
        </button>
      </td>
      <td className="px-3 py-2">
        {strategyInfo !== undefined && (
          <div className="mb-1">
            <StrategyLabel
              info={strategyInfo}
              fallback={row.strategy_name}
              dotSize={8}
              className="text-[11px] text-muted-foreground"
              truncate={false}
            />
          </div>
        )}
        <Link
          href={`/backtests/${row.id}`}
          className="hover:text-foreground text-foreground/90 hover:underline underline-offset-2 font-mono whitespace-nowrap"
        >
          {row.label?.trim() || `${row.instrument ?? '—'} · ${row.timeframe ?? '—'}`}
        </Link>
        {row.archived_at && (
          <span className="ml-2 inline-flex h-4 items-center rounded border border-border bg-muted/40 px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            archived
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-muted-foreground tabular-nums whitespace-nowrap">
            {fmtDate(row.start_date)} <span className="text-muted-foreground/40">→</span> {fmtDate(row.end_date)}
          </span>
          {d.configBadges.length > 0 && (
            <ConfigBadges badges={d.configBadges} />
          )}
        </div>
      </td>
      <td className={cn('px-3 py-2 text-right font-mono tabular-nums', pnlClass(d.net_pnl))}>
        {d.net_pnl == null ? '—' : fmtUsd(d.net_pnl, { signed: true })}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(d.win_rate)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{d.sharpe == null ? '—' : fmtNumber(d.sharpe, 2)}</td>
      <td className={cn('px-3 py-2 text-right font-mono tabular-nums', betaClass(d.beta_es))}>
        {fmtSignedNumber(d.beta_es, 4)}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtSignedPctRaw(d.alpha_daily, 4)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtSignedNumber(d.corr_es, 4)}</td>
      <td className={cn('px-3 py-2 text-right font-mono tabular-nums', d.max_drawdown != null && d.max_drawdown > 0 && 'text-[var(--negative)]')}>
        {d.max_drawdown == null ? '—' : d.max_drawdown === 0 ? fmtUsd(0) : `−${fmtUsd(d.max_drawdown)}`}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtInt(d.trades_count)}</td>
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
      <td className="px-2 py-2 text-right whitespace-nowrap">
        <BacktestInlineActions
          backtestId={row.id}
          backtestLabel={row.label?.trim() || `${row.strategy_name ?? 'Untitled'} · ${row.timeframe ?? '—'}`}
          archivedAt={row.archived_at}
        />
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

// ── Facet controls ─────────────────────────────────────────────────────────

function FacetSingle({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="uppercase tracking-widest">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded border border-border bg-card px-2 text-xs text-foreground font-mono focus:outline-none focus:border-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

function FacetMulti({
  label,
  options,
  values,
  onToggle,
}: {
  label: string
  options: { value: string; label: string }[]
  values: Set<string>
  onToggle: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null
  const summary =
    values.size === 0
      ? 'All'
      : values.size === 1
        ? options.find((o) => o.value === Array.from(values)[0])?.label ?? '1 selected'
        : `${values.size} selected`
  return (
    <div className="relative inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="uppercase tracking-widest">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-7 rounded border bg-card px-2 text-xs font-mono focus:outline-none focus:border-ring transition-colors inline-flex items-center gap-1',
          values.size > 0 ? 'border-foreground/40 text-foreground' : 'border-border text-foreground/80',
        )}
      >
        <span>{summary}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute z-40 left-0 top-full mt-1 w-[220px] rounded border border-border bg-popover shadow-xl py-1 max-h-[280px] overflow-y-auto">
            {options.map((o) => {
              const checked = values.has(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onToggle(o.value)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-muted/50 transition-colors"
                >
                  <span
                    className={cn(
                      'inline-flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors',
                      checked
                        ? 'border-foreground/60 bg-foreground/10 text-foreground'
                        : 'border-border bg-card text-transparent',
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function LabelSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="uppercase tracking-widest">Label</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="contains…"
        className="h-7 w-[140px] rounded border border-border bg-card px-2 text-xs text-foreground font-mono focus:outline-none focus:border-ring placeholder:text-muted-foreground/40"
      />
    </label>
  )
}

function SortControl({
  sortKey,
  sortDir,
  onChange,
}: {
  sortKey: SortKey
  sortDir: SortDir
  onChange: (k: SortKey, d: SortDir) => void
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="uppercase tracking-widest">Sort</span>
      <select
        value={sortKey}
        onChange={(e) => {
          const k = e.target.value as SortKey
          const def = SORT_OPTIONS.find((o) => o.key === k)?.defaultDir ?? 'desc'
          onChange(k, def)
        }}
        className="h-7 rounded border border-border bg-card px-2 text-xs text-foreground font-mono focus:outline-none focus:border-ring"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onChange(sortKey, sortDir === 'asc' ? 'desc' : 'asc')}
        aria-label={`Sort direction ${sortDir}`}
        className="h-7 rounded border border-border bg-card px-1.5 text-foreground/80 hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        {sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
    </label>
  )
}

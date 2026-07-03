'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Archive, ArchiveRestore, ChevronRight, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  fmtUsd,
  fmtPct,
  pnlClass,
} from '../backtests/_components/format'
import { ExitReasonBadge } from '../backtests/_components/exit-reason'
import { fmtTradeTime } from '@/lib/format'
import {
  archivePaperTrade,
  deletePaperTrade,
  unarchivePaperTrade,
} from './actions'

// ── Types ─────────────────────────────────────────────────────────────────

export type PaperTradeRow = {
  id: string | number
  entry_ts: string | null
  exit_ts: string | null
  side: string | null
  quantity: number | string | null
  entry_price: number | string | null
  exit_price: number | string | null
  pnl: number | string | null
  commission: number | string | null
  slippage: number | string | null
  exit_reason: string | null
  strategy_name: string | null
  instrument: string | null
  created_at: string | null
  archived_at: string | null
}

export type Group = 'day' | 'week' | 'month'

export const GROUP_LABEL: Record<Group, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
}

const WINDOW_LABEL: Record<Group, string> = {
  day: 'Last 30 days',
  week: 'Last 12 weeks',
  month: 'Last 12 months',
}

// ── Numeric coercion (same reasoning as /live) ────────────────────────────

function n(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  return 0
}

// ── ET-anchored period keys ───────────────────────────────────────────────

// Minutes-to-add to a UTC instant to reach its America/New_York wall clock.
// Kept in sync with the /live view's helper.
function nyOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date)
  const o: Record<string, string> = {}
  for (const p of parts) o[p.type] = p.value
  const nyAsUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second)
  return Math.round((nyAsUtc - date.getTime()) / 60000)
}

function toEt(date: Date): { y: number; m: number; d: number; dow: number } {
  const off = nyOffsetMinutes(date)
  const et = new Date(date.getTime() + off * 60000)
  return {
    y: et.getUTCFullYear(),
    m: et.getUTCMonth(),
    d: et.getUTCDate(),
    dow: et.getUTCDay(),
  }
}

// ISO-week style: bucket keyed by the Monday of the ET week. Sunday exits
// count for the trading week that just closed (Mon–Fri + weekend), not the
// week that hasn't started yet.
function weekMondayEt(ts: string): { key: string; label: string } {
  const et = toEt(new Date(ts))
  // Convert Sunday=0 → 6, else dow-1 so Monday is 0.
  const daysSinceMon = (et.dow + 6) % 7
  const mon = new Date(Date.UTC(et.y, et.m, et.d - daysSinceMon))
  const monY = mon.getUTCFullYear()
  const monM = mon.getUTCMonth()
  const monD = mon.getUTCDate()
  const key = `${monY}-${String(monM + 1).padStart(2, '0')}-${String(monD).padStart(2, '0')}`
  const label = `Week of ${mon.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}`
  return { key, label }
}

function dayEt(ts: string): { key: string; label: string } {
  const et = toEt(new Date(ts))
  const key = `${et.y}-${String(et.m + 1).padStart(2, '0')}-${String(et.d).padStart(2, '0')}`
  const label = new Date(Date.UTC(et.y, et.m, et.d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return { key, label }
}

function monthEt(ts: string): { key: string; label: string } {
  const et = toEt(new Date(ts))
  const key = `${et.y}-${String(et.m + 1).padStart(2, '0')}`
  const label = new Date(Date.UTC(et.y, et.m, 1)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
  return { key, label }
}

function periodOf(ts: string, group: Group): { key: string; label: string } {
  if (group === 'day') return dayEt(ts)
  if (group === 'week') return weekMondayEt(ts)
  return monthEt(ts)
}

// ── Bucket aggregation ────────────────────────────────────────────────────

type Bucket = {
  key: string
  label: string
  trades: PaperTradeRow[]
  count: number
  wins: number
  losses: number
  pnl: number
  commission: number
  slippage: number
}

function bucketize(trades: PaperTradeRow[], group: Group): Bucket[] {
  const map = new Map<string, Bucket>()
  for (const t of trades) {
    if (!t.exit_ts) continue
    const { key, label } = periodOf(t.exit_ts, group)
    let b = map.get(key)
    if (!b) {
      b = { key, label, trades: [], count: 0, wins: 0, losses: 0, pnl: 0, commission: 0, slippage: 0 }
      map.set(key, b)
    }
    const pnl = n(t.pnl)
    b.trades.push(t)
    b.count += 1
    b.pnl += pnl
    b.commission += n(t.commission)
    b.slippage += n(t.slippage)
    if (pnl > 0) b.wins += 1
    else if (pnl < 0) b.losses += 1
  }
  // Sort buckets by key desc (most recent period first).
  return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
}

// ── Summary over the whole visible window ────────────────────────────────

type WindowSummary = {
  totalPnl: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number | null
  totalCommission: number
  avgPnlPerBucket: number | null
  bestBucket: Bucket | null
  worstBucket: Bucket | null
}

function summarize(buckets: Bucket[]): WindowSummary {
  let totalPnl = 0, totalTrades = 0, wins = 0, losses = 0, totalCommission = 0
  let best: Bucket | null = null, worst: Bucket | null = null
  for (const b of buckets) {
    totalPnl += b.pnl
    totalTrades += b.count
    wins += b.wins
    losses += b.losses
    totalCommission += b.commission
    if (best == null || b.pnl > best.pnl) best = b
    if (worst == null || b.pnl < worst.pnl) worst = b
  }
  const decided = wins + losses
  const avg = buckets.length > 0 ? totalPnl / buckets.length : null
  return {
    totalPnl,
    totalTrades,
    wins,
    losses,
    winRate: decided > 0 ? wins / decided : null,
    totalCommission,
    avgPnlPerBucket: avg,
    bestBucket: best,
    worstBucket: worst,
  }
}

// ── OverviewView ──────────────────────────────────────────────────────────

export function OverviewView({
  trades,
  group,
  showArchived,
  archivedCount,
  archiveColumnAvailable,
}: {
  trades: PaperTradeRow[]
  group: Group
  showArchived: boolean
  archivedCount: number
  archiveColumnAvailable: boolean
}) {
  const buckets = useMemo(() => bucketize(trades, group), [trades, group])
  const summary = useMemo(() => summarize(buckets), [buckets])

  return (
    <div className="p-6 max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-sm font-semibold tracking-tight">Overview</h1>
        <div className="flex items-baseline gap-3 text-[10px] text-muted-foreground font-mono">
          <span>{WINDOW_LABEL[group]}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>source = paper</span>
          <span className="text-muted-foreground/40">·</span>
          <span>times in ET</span>
        </div>
      </div>

      {!archiveColumnAvailable && (
        <BackendMissingBanner />
      )}

      <SummaryStrip summary={summary} group={group} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <GroupSelector group={group} />
        <ArchiveToggle
          showArchived={showArchived}
          archivedCount={archivedCount}
          disabled={!archiveColumnAvailable}
        />
      </div>

      <BucketTable
        buckets={buckets}
        group={group}
        canArchive={archiveColumnAvailable}
      />
    </div>
  )
}

// ── Backend-missing banner ────────────────────────────────────────────────

function BackendMissingBanner() {
  return (
    <div className="rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2 text-[11px] text-[var(--warning)]">
      <span className="font-semibold uppercase tracking-widest mr-2">backend</span>
      Archive / delete are disabled — the{' '}
      <span className="font-mono">trades.archived_at</span> column doesn&apos;t
      exist yet. Ask the backend Claude to run{' '}
      <span className="font-mono">
        ALTER TABLE trades ADD COLUMN archived_at timestamptz NULL;
      </span>
    </div>
  )
}

// ── Compact summary strip ─────────────────────────────────────────────────

function SummaryStrip({ summary, group }: { summary: WindowSummary; group: Group }) {
  const perBucketLabel = group === 'day' ? 'avg/day' : group === 'week' ? 'avg/week' : 'avg/month'
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <StripStat
        label="Net P&L"
        value={fmtUsd(summary.totalPnl, { signed: true })}
        valueClass={pnlClass(summary.totalPnl)}
        sub={
          summary.avgPnlPerBucket == null
            ? undefined
            : <>{perBucketLabel} <span className={pnlClass(summary.avgPnlPerBucket)}>{fmtUsd(summary.avgPnlPerBucket, { signed: true })}</span></>
        }
      />
      <StripStat
        label="Closed trades"
        value={summary.totalTrades.toLocaleString()}
        sub={
          summary.winRate == null
            ? 'no decided trades'
            : <>{summary.wins}W / {summary.losses}L · win rate {fmtPct(summary.winRate, 0)}</>
        }
      />
      <StripStat
        label="Best / worst"
        value={
          summary.bestBucket
            ? <span className={pnlClass(summary.bestBucket.pnl)}>{fmtUsd(summary.bestBucket.pnl, { signed: true })}</span>
            : '—'
        }
        sub={
          summary.bestBucket && summary.worstBucket
            ? <>
                <span className="text-muted-foreground/60">worst </span>
                <span className={pnlClass(summary.worstBucket.pnl)}>{fmtUsd(summary.worstBucket.pnl, { signed: true })}</span>
              </>
            : undefined
        }
      />
      <StripStat
        label="Commissions"
        value={summary.totalCommission > 0 ? fmtUsd(summary.totalCommission) : '—'}
        valueClass={summary.totalCommission > 0 ? 'text-[var(--negative)]' : 'text-muted-foreground'}
        sub={
          summary.totalTrades > 0
            ? `avg ${fmtUsd(summary.totalCommission / summary.totalTrades)}/trade`
            : undefined
        }
      />
    </section>
  )
}

function StripStat({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string
  value: React.ReactNode
  valueClass?: string
  sub?: React.ReactNode
}) {
  return (
    <div className="rounded border border-border bg-card px-3 py-2.5 space-y-1">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</div>
      <div className={cn('font-mono font-semibold tabular-nums text-lg leading-none', valueClass)}>
        {value}
      </div>
      {sub != null && (
        <div className="text-[10px] text-muted-foreground font-mono">{sub}</div>
      )}
    </div>
  )
}

// ── Group selector ────────────────────────────────────────────────────────

function GroupSelector({ group }: { group: Group }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setGroup(next: Group) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('group', next)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="inline-flex items-center rounded border border-border bg-card p-0.5">
      {(['day', 'week', 'month'] as Group[]).map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => setGroup(g)}
          className={cn(
            'inline-flex items-center h-7 px-3 rounded text-[11px] font-medium transition-colors',
            group === g
              ? 'bg-[var(--sidebar-accent)] text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {GROUP_LABEL[g]}
        </button>
      ))}
    </div>
  )
}

function ArchiveToggle({
  showArchived,
  archivedCount,
  disabled,
}: {
  showArchived: boolean
  archivedCount: number
  disabled: boolean
}) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const params = new URLSearchParams(searchParams.toString())
  if (showArchived) params.delete('archived')
  else params.set('archived', '1')
  const href = `${pathname}?${params.toString()}`

  if (disabled) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground/60 cursor-not-allowed"
        title="Backend column trades.archived_at not available yet"
      >
        Show archived
      </span>
    )
  }

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
    >
      {showArchived ? 'Hide archived' : 'Show archived'}
      {!showArchived && archivedCount > 0 && (
        <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono tabular-nums">
          {archivedCount}
        </span>
      )}
    </Link>
  )
}

// ── Bucket table ──────────────────────────────────────────────────────────

function BucketTable({
  buckets,
  group,
  canArchive,
}: {
  buckets: Bucket[]
  group: Group
  canArchive: boolean
}) {
  if (buckets.length === 0) {
    return (
      <div className="rounded border border-border border-dashed bg-card/50 p-8 text-center space-y-1">
        <div className="text-xs text-muted-foreground">
          No paper trades in {WINDOW_LABEL[group].toLowerCase()}.
        </div>
        <div className="text-[10px] text-muted-foreground/70 font-mono">
          Filter: trades.source = &apos;paper&apos; · exit_ts in window
        </div>
      </div>
    )
  }

  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {GROUP_LABEL[group]} breakdown
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {buckets.length} period{buckets.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="divide-y divide-border">
        {buckets.map((b) => (
          <BucketRow key={b.key} bucket={b} canArchive={canArchive} />
        ))}
      </div>
    </section>
  )
}

function BucketRow({ bucket, canArchive }: { bucket: Bucket; canArchive: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const decided = bucket.wins + bucket.losses
  const winRate = decided > 0 ? bucket.wins / decided : null

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full grid grid-cols-[auto_1fr_repeat(5,minmax(0,1fr))] items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <div className="flex flex-col">
          <span className="text-xs font-semibold">{bucket.label}</span>
          <span className="text-[10px] text-muted-foreground font-mono">
            {bucket.count} trade{bucket.count === 1 ? '' : 's'}
          </span>
        </div>
        <MiniStat label="Net P&L" value={fmtUsd(bucket.pnl, { signed: true })} cls={pnlClass(bucket.pnl)} />
        <MiniStat label="Wins" value={`${bucket.wins}W / ${bucket.losses}L`} />
        <MiniStat label="Win rate" value={winRate == null ? '—' : fmtPct(winRate, 0)} />
        <MiniStat label="Commissions" value={bucket.commission > 0 ? `−${fmtUsd(bucket.commission)}` : '—'} cls={bucket.commission > 0 ? 'text-[var(--negative)]' : ''} />
        <MiniStat label="Avg slippage" value={bucket.count > 0 ? fmtUsd(bucket.slippage / bucket.count, { signed: true }) : '—'} />
      </button>

      {expanded && (
        <div className="border-t border-border bg-muted/20">
          <TradeSubtable trades={bucket.trades} canArchive={canArchive} />
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, cls }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="flex flex-col text-right">
      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</span>
      <span className={cn('font-mono tabular-nums text-xs font-semibold', cls)}>{value}</span>
    </div>
  )
}

// ── Trade sub-table (inside an expanded bucket) ───────────────────────────

function TradeSubtable({
  trades,
  canArchive,
}: {
  trades: PaperTradeRow[]
  canArchive: boolean
}) {
  const sorted = useMemo(
    () => trades.slice().sort((a, b) => (a.exit_ts ?? '').localeCompare(b.exit_ts ?? '')).reverse(),
    [trades],
  )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
            <th className="px-3 py-1.5 text-left font-semibold">Open</th>
            <th className="px-3 py-1.5 text-left font-semibold">Close</th>
            <th className="px-3 py-1.5 text-left font-semibold">Side</th>
            <th className="px-3 py-1.5 text-right font-semibold">Qty</th>
            <th className="px-3 py-1.5 text-right font-semibold">Entry px</th>
            <th className="px-3 py-1.5 text-right font-semibold">Exit px</th>
            <th className="px-3 py-1.5 text-right font-semibold">P&amp;L</th>
            <th className="px-3 py-1.5 text-right font-semibold">Slippage</th>
            <th className="px-3 py-1.5 text-left font-semibold">Reason</th>
            <th className="px-3 py-1.5 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <TradeRow key={t.id} t={t} canArchive={canArchive} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TradeRow({ t, canArchive }: { t: PaperTradeRow; canArchive: boolean }) {
  const sideStr = (t.side ?? '').toUpperCase()
  const isShort = sideStr.startsWith('S')
  const sideClass = isShort ? 'text-[var(--negative)]' : 'text-[var(--positive)]'
  const pnlVal = t.pnl == null ? null : n(t.pnl)
  const slipVal = t.slippage == null ? null : n(t.slippage)
  const entryVal = t.entry_price == null ? null : n(t.entry_price)
  const exitVal = t.exit_price == null ? null : n(t.exit_price)
  const qtyVal = t.quantity == null ? null : n(t.quantity)
  const archived = t.archived_at != null

  return (
    <tr
      className={cn(
        'border-b border-border/50 last:border-b-0 hover:bg-muted/30',
        archived && 'opacity-60',
      )}
    >
      <td className="px-3 py-1.5 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
        {fmtTradeTime(t.entry_ts)}
      </td>
      <td className="px-3 py-1.5 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
        {fmtTradeTime(t.exit_ts)}
      </td>
      <td className={cn('px-3 py-1.5 font-mono uppercase text-[11px]', sideClass)}>
        {sideStr || '—'}
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
        {qtyVal != null ? qtyVal.toLocaleString('en-US') : '—'}
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
        {entryVal != null ? entryVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
      </td>
      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
        {exitVal != null ? exitVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
      </td>
      <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums font-semibold', pnlClass(pnlVal))}>
        {pnlVal == null ? '—' : fmtUsd(pnlVal, { signed: true })}
      </td>
      <td className={cn(
        'px-3 py-1.5 text-right font-mono tabular-nums text-[11px] text-muted-foreground',
        slipVal != null && slipVal > 0 && 'text-[var(--negative)]',
      )}>
        {slipVal == null ? '—' : fmtUsd(slipVal, { signed: true })}
      </td>
      <td className="px-3 py-1.5">
        <ExitReasonBadge reason={t.exit_reason} />
      </td>
      <td className="px-3 py-1.5 text-right">
        <TradeActions
          tradeId={String(t.id)}
          archived={archived}
          canArchive={canArchive}
        />
      </td>
    </tr>
  )
}

// ── Per-trade actions (archive / unarchive / delete) ──────────────────────

function TradeActions({
  tradeId,
  archived,
  canArchive,
}: {
  tradeId: string
  archived: boolean
  canArchive: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function doArchive() {
    if (!canArchive) return
    setError(null)
    startTransition(async () => {
      const res = archived
        ? await unarchivePaperTrade(tradeId)
        : await archivePaperTrade(tradeId)
      if (!res.ok) setError(res.error === 'unauthorized' ? 'not signed in' : 'update failed')
    })
  }

  function doDelete() {
    setError(null)
    startTransition(async () => {
      const res = await deletePaperTrade(tradeId)
      if (!res.ok) setError(res.error === 'unauthorized' ? 'not signed in' : 'delete failed')
      else setDeleteOpen(false)
    })
  }

  return (
    <>
      <div className="inline-flex items-center gap-1">
        <IconButton
          label={archived ? 'Unarchive' : 'Archive'}
          onClick={doArchive}
          disabled={!canArchive || pending}
          tone="default"
        >
          {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        </IconButton>
        <IconButton
          label="Delete permanently"
          onClick={() => setDeleteOpen(true)}
          disabled={pending}
          tone="danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      {error && (
        <div className="text-[10px] text-[var(--negative)] font-mono mt-1">{error}</div>
      )}

      {deleteOpen && (
        <DeleteDialog
          onClose={() => setDeleteOpen(false)}
          onConfirm={doDelete}
          pending={pending}
        />
      )}
    </>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone: 'default' | 'danger'
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded border transition-colors',
        tone === 'danger'
          ? 'border-border bg-card text-muted-foreground hover:border-[var(--negative)]/40 hover:bg-[var(--negative)]/10 hover:text-[var(--negative)]'
          : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {children}
    </button>
  )
}

function DeleteDialog({
  onClose,
  onConfirm,
  pending,
}: {
  onClose: () => void
  onConfirm: () => void
  pending: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={pending ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded border border-border bg-popover p-5 space-y-4 shadow-xl"
      >
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Delete paper trade permanently?</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This row will be removed from Supabase. This cannot be undone.
            Consider archiving if you want to preserve history.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="h-7 rounded border border-border bg-card px-3 text-xs hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              'h-7 rounded border px-3 text-xs transition-colors',
              'border-[var(--negative)]/40 bg-[var(--negative)]/15 text-[var(--negative)] hover:bg-[var(--negative)]/25',
              pending && 'opacity-60 cursor-not-allowed',
            )}
          >
            {pending ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}

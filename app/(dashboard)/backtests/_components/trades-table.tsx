'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fmtDuration, fmtUsd, pnlClass } from './format'
import { fmtTradeTime } from '@/lib/format'
import { ExitReasonBadge } from './exit-reason'

export type Trade = {
  id: string | number
  entry_ts: string | null
  exit_ts: string | null
  side: string | null
  entry_price: number | null
  exit_price: number | null
  quantity: number | null
  pnl: number | null
  commission: number | null
  slippage: number | null
  source: string | null
  exit_reason: string | null
}

type SortKey =
  | 'entry_ts'
  | 'exit_ts'
  | 'side'
  | 'entry_price'
  | 'exit_price'
  | 'quantity'
  | 'pnl'
  | 'commission'
  | 'slippage'
  | 'exit_reason'
  | 'duration'

type SortDir = 'asc' | 'desc'

function tradeDurationMs(t: Trade): number | null {
  if (!t.entry_ts || !t.exit_ts) return null
  const a = new Date(t.entry_ts).getTime()
  const b = new Date(t.exit_ts).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return b - a
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

function getSortValue(t: Trade, key: SortKey): unknown {
  switch (key) {
    case 'entry_ts': return t.entry_ts
    case 'exit_ts': return t.exit_ts
    case 'side': return t.side
    case 'entry_price': return t.entry_price
    case 'exit_price': return t.exit_price
    case 'quantity': return t.quantity
    case 'pnl': return t.pnl
    case 'commission': return t.commission
    case 'slippage': return t.slippage
    case 'exit_reason': return t.exit_reason
    case 'duration': return tradeDurationMs(t)
  }
}

export function TradesTable({ trades }: { trades: Trade[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('entry_ts')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const sorted = useMemo(() => {
    const out = [...trades]
    out.sort((a, b) => {
      const r = cmp(getSortValue(a, sortKey), getSortValue(b, sortKey))
      return sortDir === 'asc' ? r : -r
    })
    return out
  }, [trades, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      const stringCols: SortKey[] = ['side', 'exit_reason']
      setSortDir(stringCols.includes(key) ? 'asc' : 'desc')
    }
  }

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
          <tr className="border-b border-border bg-muted/30">
            <Th label="Open (ET)"   k="entry_ts"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <Th label="Close (ET)"  k="exit_ts"     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <Th label="Side"        k="side"        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <Th label="Entry px"    k="entry_price" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
            <Th label="Exit px"     k="exit_price"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
            <Th label="Qty"         k="quantity"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
            <Th label="P&L"         k="pnl"         sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
            <Th label="Commission"  k="commission"  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
            <Th label="Slippage"    k="slippage"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
            <Th label="Exit reason" k="exit_reason" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
            <Th label="Duration"    k="duration"    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const duration = tradeDurationMs(t)
            const sideClass =
              (t.side ?? '').toLowerCase().startsWith('s') ? 'text-[var(--negative)]' : 'text-[var(--positive)]'
            return (
              <tr key={t.id} className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
                <td className="px-3 py-1.5 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                  {fmtTradeTime(t.entry_ts)}
                </td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                  {fmtTradeTime(t.exit_ts)}
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
                  {t.quantity != null ? t.quantity.toLocaleString('en-US') : '—'}
                </td>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', pnlClass(t.pnl))}>
                  {t.pnl == null ? '—' : fmtUsd(t.pnl, { signed: true })}
                </td>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', t.commission != null && 'text-[var(--negative)]')}>
                  {t.commission == null ? '—' : fmtUsd(t.commission)}
                </td>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', t.slippage != null && 'text-[var(--negative)]')}>
                  {t.slippage == null ? '—' : fmtUsd(t.slippage)}
                </td>
                <td className="px-3 py-1.5">
                  <ExitReasonBadge reason={t.exit_reason} />
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
          'inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer',
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

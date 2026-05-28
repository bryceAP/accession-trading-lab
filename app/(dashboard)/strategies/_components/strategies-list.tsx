'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { StatusBadge } from './status-badge'
import { fmtUsd, pnlClass } from '../../backtests/_components/format'

export type StrategyRow = {
  id: string
  name: string | null
  version: string | null
  instrument: string | null
  description: string | null
  status: string | null
  updated_at: string | null
  bestPnl: number | null
  backtestCount: number
}

export function StrategiesList({ rows }: { rows: StrategyRow[] }) {
  const [showArchived, setShowArchived] = useState(false)

  const visible = useMemo(
    () => (showArchived ? rows : rows.filter((r) => r.status !== 'archived')),
    [rows, showArchived],
  )

  const archivedCount = useMemo(
    () => rows.filter((r) => r.status === 'archived').length,
    [rows],
  )

  return (
    <div className="space-y-3">
      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3 w-3 accent-foreground"
          />
          Show archived
          {archivedCount > 0 && (
            <span className="font-mono tabular-nums text-muted-foreground/70">({archivedCount})</span>
          )}
        </label>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {visible.length} of {rows.length}
        </span>
      </div>

      {/* ── Cards grid ──────────────────────────────────────── */}
      {visible.length === 0 ? (
        <div className="rounded border border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
          {rows.length === 0
            ? 'No strategies yet.'
            : showArchived
              ? 'No strategies match.'
              : 'No active strategies. Toggle "Show archived" to see archived ones.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map((s) => (
            <StrategyCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function StrategyCard({ s }: { s: StrategyRow }) {
  const isArchived = s.status === 'archived'
  return (
    <Link
      href={`/strategies/${s.id}`}
      className={cn(
        'group block rounded border border-border bg-card hover:border-foreground/30 hover:bg-muted/30 transition-colors p-4 space-y-3',
        isArchived && 'opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-sm font-semibold tracking-tight truncate group-hover:text-foreground">
              {s.name ?? 'Unnamed'}
            </h3>
            {s.version && (
              <span className="text-[10px] font-mono text-muted-foreground">v{s.version}</span>
            )}
          </div>
          {s.instrument && (
            <span className="inline-block rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              {s.instrument}
            </span>
          )}
        </div>
        <StatusBadge status={s.status} />
      </div>

      {s.description && (
        <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
          {s.description}
        </p>
      )}

      <div className="flex items-end justify-between gap-3 pt-1 border-t border-border">
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Best backtest
          </div>
          {s.bestPnl != null ? (
            <div className={cn('text-sm font-mono font-semibold tabular-nums', pnlClass(s.bestPnl))}>
              {fmtUsd(s.bestPnl, { signed: true })}
            </div>
          ) : (
            <div className="text-sm font-mono text-muted-foreground">—</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Backtests
          </div>
          <div className="text-sm font-mono tabular-nums">{s.backtestCount}</div>
        </div>
      </div>
    </Link>
  )
}

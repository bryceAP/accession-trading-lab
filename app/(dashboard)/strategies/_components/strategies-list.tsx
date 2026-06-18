'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { StatusBadge } from './status-badge'
import { fmtUsd, pnlClass } from '../../backtests/_components/format'
import { StrategyDot } from '@/components/strategy-label'
import { strategyLabel } from '@/lib/strategy-names'

export type StrategyRow = {
  id: string
  name: string | null
  display_name: string | null
  version: string | null
  instrument: string | null
  description: string | null
  status: string | null
  updated_at: string | null
  archived_at: string | null
  bestPnl: number | null
  backtestCount: number
}

export function StrategiesList({ rows }: { rows: StrategyRow[] }) {
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="rounded border border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
          No strategies match.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map((s) => (
            <StrategyCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function StrategyCard({ s }: { s: StrategyRow }) {
  const isArchived = s.archived_at != null
  const primary = strategyLabel(s, 'Unnamed')
  const showSecondary = s.display_name && s.name && primary !== s.name
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
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <StrategyDot name={s.name} />
            <h3 className="text-sm font-semibold tracking-tight truncate group-hover:text-foreground">
              {primary}
            </h3>
            {s.version && (
              <span className="text-[10px] font-mono text-muted-foreground">v{s.version}</span>
            )}
            {isArchived && (
              <span className="inline-flex h-4 items-center rounded border border-border bg-muted/40 px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                archived
              </span>
            )}
          </div>
          {showSecondary && (
            <div className="text-[10px] font-mono text-muted-foreground truncate" title={s.name ?? undefined}>
              {s.name}
            </div>
          )}
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

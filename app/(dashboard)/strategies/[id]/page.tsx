import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CodeBlock } from '../_components/code-block'
import { StatusBadge } from '../_components/status-badge'
import { StatusControl } from '../_components/status-control'
import { DeleteStrategy } from '../_components/delete-strategy'
import { NotesThread, type Note } from '../_components/notes-thread'
import {
  fmtDate,
  fmtNumber,
  fmtPct,
  fmtUsd,
  pickMetric,
  pnlClass,
  relativeTime,
} from '../../backtests/_components/format'

type Strategy = {
  id: string
  name: string | null
  version: string | null
  instrument: string | null
  description: string | null
  status: string | null
  code_text: string | null
  commit_hash: string | null
  parameters: Record<string, unknown> | null
  author: string | null
  created_at: string | null
  updated_at: string | null
}

type BacktestLite = {
  id: string
  start_date: string | null
  end_date: string | null
  completed_at: string | null
  metrics: Record<string, unknown> | null
}

function paramValueToString(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return v.toString()
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export default async function StrategyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()

  // Fetch the strategy first; the backtests query depends on its name for fallback matching.
  const stratRes = await supabase
    .from('strategies')
    .select('id, name, version, instrument, description, status, code_text, commit_hash, parameters, author, created_at, updated_at')
    .eq('id', params.id)
    .maybeSingle()

  if (stratRes.error) console.error('[StrategyDetail strategy]', stratRes.error)

  const strategy = stratRes.data as Strategy | null

  if (!strategy) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Link href="/strategies" className="text-xs text-muted-foreground hover:text-foreground">
            ← Strategies
          </Link>
          <Badge variant="destructive" className="text-xs">Not found</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          No strategy with id <span className="font-mono">{params.id}</span>.
        </p>
      </div>
    )
  }

  // Backtests: match on strategy_id first; merge by strategy_name as a fallback
  // since the Python side may write either field.
  let backtestsQuery = supabase
    .from('backtests')
    .select('id, start_date, end_date, completed_at, metrics')

  if (strategy.name) {
    backtestsQuery = backtestsQuery.or(`strategy_id.eq.${strategy.id},strategy_name.eq.${strategy.name}`)
  } else {
    backtestsQuery = backtestsQuery.eq('strategy_id', strategy.id)
  }

  const [btRes, notesRes] = await Promise.all([
    backtestsQuery.order('completed_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('notes')
      .select('id, author, body, created_at')
      .eq('target_type', 'strategy')
      .eq('target_id', params.id)
      .order('created_at', { ascending: false }),
  ])

  if (btRes.error) console.error('[StrategyDetail backtests]', btRes.error)
  if (notesRes.error) console.error('[StrategyDetail notes]', notesRes.error)

  const backtests = (btRes.data ?? []) as BacktestLite[]
  const notes = (notesRes.data ?? []) as Note[]

  const updated = strategy.updated_at ? new Date(strategy.updated_at) : null
  const parameters = strategy.parameters ?? {}
  const paramKeys = Object.keys(parameters)

  return (
    <div className="p-6 space-y-5 max-w-[1200px]">
      {/* ── Back link ─────────────────────────────────────────── */}
      <div>
        <Link href="/strategies" className="text-xs text-muted-foreground hover:text-foreground">
          ← Strategies
        </Link>
      </div>

      {/* ── Header ────────────────────────────────────────────── */}
      <header className="rounded border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <div className="space-y-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1 className="text-sm font-semibold tracking-tight">{strategy.name ?? params.id}</h1>
              {strategy.version && (
                <span className="text-[11px] font-mono text-muted-foreground">v{strategy.version}</span>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-muted-foreground font-mono">
              {strategy.instrument && (
                <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5">{strategy.instrument}</span>
              )}
              {strategy.author && <span>by {strategy.author}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={strategy.status} />
            {updated && (
              <span
                className="text-[10px] text-muted-foreground font-mono"
                title={strategy.updated_at ?? undefined}
              >
                updated {relativeTime(updated)}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── Description ───────────────────────────────────────── */}
      <section className="rounded border border-border bg-card p-4 space-y-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Description
        </h2>
        {strategy.description ? (
          <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {strategy.description}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground italic">No description.</p>
        )}
      </section>

      {/* ── Parameters ────────────────────────────────────────── */}
      <section className="rounded border border-border bg-card p-4 space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Parameters
        </h2>
        {paramKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No parameters.</p>
        ) : (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            {paramKeys.map((k) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1.5 last:border-b-0">
                <dt className="text-muted-foreground font-mono">{k}</dt>
                <dd className="text-foreground font-mono tabular-nums break-all text-right">
                  {paramValueToString(parameters[k])}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* ── Code ──────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Strategy code
          </h2>
          {strategy.commit_hash && (
            <div className="text-[11px] text-muted-foreground font-mono space-x-2">
              <span>commit</span>
              <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-foreground">
                {strategy.commit_hash.slice(0, 12)}
              </span>
              <span className="text-muted-foreground/70">
                — to revert, checkout this commit in <span className="text-foreground">mes-algo</span>
              </span>
            </div>
          )}
        </div>
        {strategy.code_text ? (
          <CodeBlock code={strategy.code_text} lang="python" />
        ) : (
          <div className="rounded border border-border bg-card p-6 text-center text-xs text-muted-foreground">
            No code recorded for this strategy.
          </div>
        )}
      </section>

      {/* ── Backtests ─────────────────────────────────────────── */}
      <section className="rounded border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Backtests
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {backtests.length}
          </span>
        </div>
        <BacktestsList backtests={backtests} />
      </section>

      {/* ── Controls ──────────────────────────────────────────── */}
      <section className="rounded border border-border bg-card p-4 space-y-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Controls
        </h2>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <StatusControl strategyId={strategy.id} initial={strategy.status} />
          <DeleteStrategy
            strategyId={strategy.id}
            strategyName={strategy.name ?? strategy.id}
            backtestCount={backtests.length}
          />
        </div>
      </section>

      {/* ── Notes ─────────────────────────────────────────────── */}
      <section className="space-y-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Notes
        </h2>
        <NotesThread strategyId={strategy.id} notes={notes} />
      </section>
    </div>
  )
}

function BacktestsList({ backtests }: { backtests: BacktestLite[] }) {
  if (backtests.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-muted-foreground">
        No backtests for this strategy.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
            <th className="px-3 py-2 text-left font-semibold">Date range</th>
            <th className="px-3 py-2 text-right font-semibold">Total P&L</th>
            <th className="px-3 py-2 text-right font-semibold">Win rate</th>
            <th className="px-3 py-2 text-right font-semibold">Sharpe</th>
            <th className="px-3 py-2 text-right font-semibold">Trades</th>
            <th className="px-3 py-2 text-right font-semibold">Completed</th>
          </tr>
        </thead>
        <tbody>
          {backtests.map((b) => {
            const totalPnl = pickMetric(b.metrics, 'total_pnl')
            const winRate = pickMetric(b.metrics, 'win_rate')
            const sharpe = pickMetric(b.metrics, 'sharpe')
            const trades = pickMetric(b.metrics, 'total_trades')
            const completed = b.completed_at ? new Date(b.completed_at) : null
            return (
              <tr key={b.id} className="border-b border-border last:border-b-0 hover:bg-muted/40 transition-colors">
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <Link
                    href={`/backtests/${b.id}`}
                    className="font-mono text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
                  >
                    {fmtDate(b.start_date)} <span className="text-muted-foreground/40">→</span> {fmtDate(b.end_date)}
                  </Link>
                </td>
                <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', pnlClass(totalPnl))}>
                  {totalPnl == null ? '—' : fmtUsd(totalPnl, { signed: true })}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtPct(winRate)}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {sharpe == null ? '—' : fmtNumber(sharpe, 2)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {trades == null ? '—' : Math.round(trades).toLocaleString('en-US')}
                </td>
                <td
                  className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground whitespace-nowrap"
                  title={b.completed_at ?? undefined}
                >
                  {completed ? relativeTime(completed) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

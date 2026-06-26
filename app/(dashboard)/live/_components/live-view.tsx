'use client'

import { useEffect, useMemo, useState } from 'react'
import { Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  fmtUsd,
  pnlClass,
  relativeTime,
} from '../../backtests/_components/format'
import { fmtTradeTime } from '@/lib/format'
import {
  eventStyle,
  eventSummary,
  formatET,
  sourceStyle,
} from '../../activity/_components/styles'

// ── Types ──────────────────────────────────────────────────────────────────

export type LivePaperStatus = {
  id: number
  strategy_name: string | null
  is_running: boolean | null
  started_at: string | null
  last_heartbeat: string | null
  position_qty: number | null
  position_avg_price: number | null
  daily_pnl: number | null
  updated_at: string | null
}

export type LiveTrade = {
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
  instrument: string | null
  source: string | null
}

export type LiveEvent = {
  id: number
  ts: string
  event_type: string
  source: string
  data: Record<string, unknown> | null
}

// ── Derived helpers ───────────────────────────────────────────────────────

const HEARTBEAT_FRESH_MS = 2 * 60 * 1000        // < 2 min: connected
const HEARTBEAT_STALE_MS = 10 * 60 * 1000       // 2–10 min: stale; > 10 min: disconnected

type ConnectionState = 'connected' | 'stale' | 'disconnected' | 'stopped' | 'idle'

function connectionState(ps: LivePaperStatus | null, nowMs: number): ConnectionState {
  if (!ps) return 'idle'
  if (!ps.is_running) return 'stopped'
  if (!ps.last_heartbeat) return 'disconnected'
  const age = nowMs - new Date(ps.last_heartbeat).getTime()
  if (Number.isNaN(age) || age >= HEARTBEAT_STALE_MS) return 'disconnected'
  if (age >= HEARTBEAT_FRESH_MS) return 'stale'
  return 'connected'
}

const CONNECTION_STYLES: Record<ConnectionState, { label: string; cls: string; dot: string }> = {
  connected:    { label: 'Connected',    cls: 'border-[var(--positive)]/30 text-[var(--positive)] bg-[var(--positive)]/10', dot: 'bg-[var(--positive)] animate-pulse' },
  stale:        { label: 'Stale',        cls: 'border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning)]/10',   dot: 'bg-[var(--warning)]' },
  disconnected: { label: 'Disconnected', cls: 'border-[var(--negative)]/30 text-[var(--negative)] bg-[var(--negative)]/10', dot: 'bg-[var(--negative)]' },
  stopped:      { label: 'Stopped',      cls: 'border-border text-muted-foreground bg-muted/40', dot: 'bg-muted-foreground/40' },
  idle:         { label: 'No session',   cls: 'border-border text-muted-foreground bg-muted/40', dot: 'bg-muted-foreground/30' },
}

function isSessionInactive(ps: LivePaperStatus | null, tradesCount: number): boolean {
  // "No active session" when paper_status is missing AND there's nothing
  // else to show (no trades today). If we have any signal, render normally.
  if (ps) return false
  if (tradesCount > 0) return false
  return true
}

// ── LiveView ──────────────────────────────────────────────────────────────

export function LiveView({
  initialStatus,
  initialTrades,
  initialEvents,
  statusError,
  tradesError,
  eventsError,
}: {
  initialStatus: LivePaperStatus | null
  initialTrades: LiveTrade[]
  initialEvents: LiveEvent[]
  statusError: string | null
  tradesError: string | null
  eventsError: string | null
}) {
  const supabase = useMemo(() => createClient(), [])

  const [status, setStatus] = useState<LivePaperStatus | null>(initialStatus)
  const [trades, setTrades] = useState<LiveTrade[]>(initialTrades)
  const [events, setEvents] = useState<LiveEvent[]>(initialEvents)
  const [newTradeIds, setNewTradeIds] = useState<Set<string | number>>(new Set())
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set())

  // Tick "now" once per second so relative timestamps and the connection
  // pill keep refreshing even when the writer hasn't pushed an update.
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Realtime: paper_status (INSERT + UPDATE) ─────────────────
  useEffect(() => {
    const ch = supabase
      .channel('public:paper_status:live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'paper_status' },
        (payload) => {
          const row = (payload.new ?? payload.old) as LivePaperStatus | null
          if (!row) return
          // We're only interested in id=1 (the singleton).
          if (row.id !== 1) return
          if (payload.eventType === 'DELETE') {
            setStatus(null)
            return
          }
          setStatus(row)
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase])

  // ── Realtime: trades (INSERT + UPDATE, filter source=paper at Postgres) ─
  useEffect(() => {
    const ch = supabase
      .channel('public:trades:live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: 'source=eq.paper' },
        (payload) => {
          const t = payload.new as LiveTrade
          if (!t || t.source !== 'paper') return
          setTrades((prev) => {
            if (prev.some((x) => x.id === t.id)) return prev
            return [t, ...prev]
          })
          setNewTradeIds((prev) => {
            const next = new Set(prev)
            next.add(t.id)
            return next
          })
          setTimeout(() => {
            setNewTradeIds((prev) => {
              if (!prev.has(t.id)) return prev
              const next = new Set(prev)
              next.delete(t.id)
              return next
            })
          }, 2500)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trades', filter: 'source=eq.paper' },
        (payload) => {
          const t = payload.new as LiveTrade
          if (!t || t.source !== 'paper') return
          setTrades((prev) => prev.map((x) => (x.id === t.id ? t : x)))
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase])

  // ── Realtime: events (INSERT) ────────────────────────────────
  useEffect(() => {
    const ch = supabase
      .channel('public:events:live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          const ev = payload.new as LiveEvent
          if (!ev || (ev.source !== 'paper' && ev.source !== 'live')) return
          setEvents((prev) => {
            if (prev.some((x) => x.id === ev.id)) return prev
            return [ev, ...prev]
          })
          setNewEventIds((prev) => {
            const next = new Set(prev)
            next.add(ev.id)
            return next
          })
          setTimeout(() => {
            setNewEventIds((prev) => {
              if (!prev.has(ev.id)) return prev
              const next = new Set(prev)
              next.delete(ev.id)
              return next
            })
          }, 2500)
        },
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [supabase])

  // ── Inferred / derived state ─────────────────────────────────
  const conn = connectionState(status, now)
  const positionQty = status?.position_qty ?? 0
  const hasPosition = positionQty !== 0
  // No instrument column on paper_status — derive from the most recent paper/
  // live trade as a best effort.
  const inferredInstrument = trades.find((t) => t.instrument)?.instrument ?? null

  // session realized P&L: paper_status.daily_pnl is the writer-maintained
  // value. Fall back to summing today's trades if it's missing.
  const tradesPnlSum = trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
  const sessionPnl = status?.daily_pnl ?? (trades.length > 0 ? tradesPnlSum : null)

  const inactive = isSessionInactive(status, trades.length)

  return (
    <div className="space-y-5">
      <StatusPanel
        status={status}
        conn={conn}
        hasPosition={hasPosition}
        positionQty={positionQty}
        inferredInstrument={inferredInstrument}
        sessionPnl={sessionPnl}
        now={now}
        inactive={inactive}
      />

      {statusError && (
        <ErrorBanner label="paper_status" message={statusError} />
      )}

      {!inactive && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TradesPanel trades={trades} newIds={newTradeIds} error={tradesError} />
          <EventsPanel events={events} newIds={newEventIds} error={eventsError} />
        </div>
      )}
    </div>
  )
}

function ErrorBanner({ label, message }: { label: string; message: string }) {
  return (
    <div className="rounded border border-[var(--negative)]/40 bg-[var(--negative)]/10 px-3 py-2 text-xs text-[var(--negative)] font-mono">
      <span className="font-semibold uppercase tracking-widest mr-2">[{label}]</span>
      {message}
    </div>
  )
}

// ── Status panel ──────────────────────────────────────────────────────────

function StatusPanel({
  status,
  conn,
  hasPosition,
  positionQty,
  inferredInstrument,
  sessionPnl,
  now,
  inactive,
}: {
  status: LivePaperStatus | null
  conn: ConnectionState
  hasPosition: boolean
  positionQty: number
  inferredInstrument: string | null
  sessionPnl: number | null
  now: number
  inactive: boolean
}) {
  if (inactive) {
    return (
      <div className="rounded border border-border border-dashed bg-card/50 p-10 text-center space-y-2">
        <div className="inline-flex items-center gap-2 text-muted-foreground">
          <Radio className="h-4 w-4" />
          <span className="text-xs font-medium tracking-wider uppercase">No active trading session</span>
        </div>
        <p className="text-[11px] text-muted-foreground/70">
          When a paper or live session starts, status, trades, and events will appear here in real time.
        </p>
      </div>
    )
  }

  const connStyle = CONNECTION_STYLES[conn]
  const hbDate = status?.last_heartbeat ? new Date(status.last_heartbeat) : null
  const hbAge = hbDate ? now - hbDate.getTime() : null
  const startedDate = status?.started_at ? new Date(status.started_at) : null

  return (
    <section className="rounded border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold tracking-tight">
              {status?.strategy_name ?? '—'}
            </h2>
            {inferredInstrument && (
              <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                {inferredInstrument}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[10px] text-muted-foreground font-mono">
            {startedDate && <span>started {relativeTime(startedDate)}</span>}
            {hbDate && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span title={status?.last_heartbeat ?? undefined}>
                  heartbeat {relativeTime(hbDate)}
                </span>
              </>
            )}
          </div>
        </div>

        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest',
            connStyle.cls,
          )}
          title={
            hbAge != null
              ? `Heartbeat age: ${Math.round(hbAge / 1000)}s`
              : undefined
          }
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', connStyle.dot)} />
          {connStyle.label}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Position"
          value={
            hasPosition
              ? <span className="text-base">
                  <span className={positionQty > 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}>
                    {positionQty > 0 ? 'Long' : 'Short'}
                  </span>{' '}
                  {Math.abs(positionQty)}
                </span>
              : <span className="text-base text-muted-foreground">Flat</span>
          }
          sub={
            hasPosition && status?.position_avg_price != null
              ? `entry ${Number(status.position_avg_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : hasPosition
                ? undefined
                : 'no position'
          }
        />
        <StatCard
          label="Current price"
          value={<span className="text-base text-muted-foreground">—</span>}
          sub="not tracked"
        />
        <StatCard
          label="Unrealized P&L"
          value={<span className="text-base text-muted-foreground">—</span>}
          sub="needs current price"
        />
        <StatCard
          label="Session realized P&L"
          value={
            sessionPnl == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className={cn('text-base', pnlClass(sessionPnl))}>
                  {fmtUsd(sessionPnl, { signed: true })}
                </span>
          }
        />
      </div>
    </section>
  )
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="rounded border border-border bg-card px-3 py-2.5 space-y-1">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{label}</div>
      <div className="font-mono font-semibold tabular-nums leading-none">{value}</div>
      {sub != null && <div className="text-[10px] text-muted-foreground font-mono">{sub}</div>}
    </div>
  )
}

// ── Trades panel ──────────────────────────────────────────────────────────

function TradesPanel({
  trades,
  newIds,
  error,
}: {
  trades: LiveTrade[]
  newIds: Set<string | number>
  error: string | null
}) {
  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Paper trades · last 24h
        </h2>
        <div className="flex items-center gap-2">
          {/* Paper trades use simulated fills, so costs are "estimated".
              Mirrors the badge on /backtests/[id]. */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest"
            title="Costs are simulated for paper trading"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)]" />
            estimated
          </span>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            {trades.length}
          </span>
        </div>
      </div>

      {error ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--negative)] font-mono">
          Query error: {error}
        </div>
      ) : trades.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground space-y-1">
          <div>No paper trades in the last 24h.</div>
          <div className="text-[10px] text-muted-foreground/70">
            Filter: <span className="font-mono">trades.source = &apos;paper&apos;</span>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-3 py-2 text-left  font-semibold">Open (ET)</th>
                <th className="px-3 py-2 text-left  font-semibold">Close (ET)</th>
                <th className="px-3 py-2 text-left  font-semibold">Side</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Entry px</th>
                <th className="px-3 py-2 text-right font-semibold">Exit px</th>
                <th className="px-3 py-2 text-right font-semibold">Gross P&L</th>
                <th className="px-3 py-2 text-right font-semibold">Commission</th>
                <th className="px-3 py-2 text-right font-semibold">Slippage</th>
                <th className="px-3 py-2 text-right font-semibold">Net</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const sideClass =
                  (t.side ?? '').toLowerCase().startsWith('s') ? 'text-[var(--negative)]' : 'text-[var(--positive)]'
                const isNew = newIds.has(t.id)
                const isOpen = t.exit_ts == null
                const net =
                  t.pnl == null
                    ? null
                    : t.pnl - (t.commission ?? 0) - (t.slippage ?? 0)
                return (
                  <tr
                    key={t.id}
                    className={cn(
                      'border-b border-border last:border-b-0 transition-colors',
                      isNew ? 'bg-[var(--positive)]/10 animate-pulse' : 'hover:bg-muted/40',
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                      {fmtTradeTime(t.entry_ts)}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                      {isOpen
                        ? <span className="text-[var(--warning)]">open</span>
                        : fmtTradeTime(t.exit_ts)}
                    </td>
                    <td className={cn('px-3 py-1.5 font-mono uppercase text-[11px]', sideClass)}>
                      {t.side ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {t.quantity != null ? t.quantity.toLocaleString('en-US') : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {t.entry_price != null ? t.entry_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {t.exit_price != null ? t.exit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
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
                    <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums font-semibold', pnlClass(net))}>
                      {net == null ? '—' : fmtUsd(net, { signed: true })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Events panel ──────────────────────────────────────────────────────────

function EventsPanel({
  events,
  newIds,
  error,
}: {
  events: LiveEvent[]
  newIds: Set<number>
  error: string | null
}) {
  return (
    <section className="rounded border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Live event feed
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {events.length}
        </span>
      </div>
      {error ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--negative)] font-mono">
          Query error: {error}
        </div>
      ) : events.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground space-y-1">
          <div>No paper or live events yet.</div>
          <div className="text-[10px] text-muted-foreground/70">
            Filter: <span className="font-mono">events.source ∈ (&apos;paper&apos;,&apos;live&apos;)</span>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border max-h-[480px] overflow-auto">
          {events.map((ev) => {
            const style = eventStyle(ev.event_type)
            const isNew = newIds.has(ev.id)
            return (
              <li
                key={ev.id}
                className={cn(
                  'flex items-baseline gap-2.5 px-4 py-2 transition-colors',
                  isNew ? 'bg-[var(--positive)]/10 animate-pulse' : 'hover:bg-muted/40',
                )}
              >
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0 w-[88px]" title={ev.ts}>
                  {formatET(ev.ts)}
                </span>
                <span className={cn('font-mono text-[10px] font-bold tracking-wider shrink-0 w-12', style.cls)}>
                  {style.label}
                </span>
                <span className={cn(
                  'inline-flex items-center h-4 rounded border px-1.5 text-[9px] font-mono uppercase tracking-wider shrink-0',
                  sourceStyle(ev.source),
                )}>
                  {ev.source}
                </span>
                <span className="text-xs text-foreground/85 truncate flex-1 min-w-0">
                  {eventSummary(ev.event_type, ev.data)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

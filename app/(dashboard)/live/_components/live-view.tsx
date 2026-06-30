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
  connection_state: 'connected' | 'stopped' | 'disconnected' | null
  instrument: string | null
  position_side: 'LONG' | 'SHORT' | 'FLAT' | null
  position_qty: number | null
  position_avg_price: number | null
  current_price: number | null
  unrealized_pnl: number | null
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

// paper_status.last_heartbeat is updated once per closed 5m bar in flat
// markets (paper.py: every 5th 1m bar). A 2-min FRESH window false-flagged
// stale-yellow for ~3 of every 5 minutes. 390s = 5min + 90s jitter buffer.
const HEARTBEAT_FRESH_MS = 390 * 1000           // < 6.5 min: connected
const HEARTBEAT_STALE_MS = 10 * 60 * 1000       // 6.5–10 min: stale; > 10 min: disconnected

type ConnectionState = 'connected' | 'stale' | 'disconnected' | 'stopped' | 'idle'

function connectionState(ps: LivePaperStatus | null, nowMs: number): ConnectionState {
  if (!ps) return 'idle'
  if (!ps.is_running) return 'stopped'
  // Explicit signal from the runner trumps heartbeat-age inference: the runner
  // sets connection_state='disconnected' inside the IB-gateway failure path
  // before the heartbeat goes stale, so trust it when set.
  if (ps.connection_state === 'disconnected') return 'disconnected'
  if (ps.connection_state === 'stopped') return 'stopped'
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
  initialOpenPosition,
  initialFills,
  statusError,
  tradesError,
  eventsError,
}: {
  initialStatus: LivePaperStatus | null
  initialTrades: LiveTrade[]
  initialEvents: LiveEvent[]
  initialOpenPosition: LiveEvent | null
  initialFills: LiveEvent[]
  statusError: string | null
  tradesError: string | null
  eventsError: string | null
}) {
  const supabase = useMemo(() => createClient(), [])

  const [status, setStatus] = useState<LivePaperStatus | null>(initialStatus)
  const [trades, setTrades] = useState<LiveTrade[]>(initialTrades)
  const [events, setEvents] = useState<LiveEvent[]>(initialEvents)
  const [openPosition, setOpenPosition] = useState<LiveEvent | null>(initialOpenPosition)
  const [fills, setFills] = useState<LiveEvent[]>(initialFills)
  const [newTradeIds, setNewTradeIds] = useState<Set<string | number>>(new Set())
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set())
  const [rtState, setRtState] = useState<RealtimeChannelStates>({
    status: 'CLOSED', trades: 'CLOSED', events: 'CLOSED',
  })

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
      .subscribe((s) => setRtState((prev) => ({ ...prev, status: s })))
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
      .subscribe((s) => setRtState((prev) => ({ ...prev, trades: s })))
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
          // Mirror the relevant subset into the open-position + fills feeds
          // so the SL/TP card and slippage tracker stay in sync without an
          // extra fetch round-trip.
          if (ev.source === 'paper') {
            if (ev.event_type === 'position_opened') {
              setOpenPosition(ev)
            } else if (ev.event_type === 'position_closed') {
              setOpenPosition(null)
            } else if (ev.event_type === 'order_filled') {
              setFills((prev) => {
                if (prev.some((x) => x.id === ev.id)) return prev
                return [ev, ...prev]
              })
            }
          }
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
      .subscribe((s) => setRtState((prev) => ({ ...prev, events: s })))
    return () => { supabase.removeChannel(ch) }
  }, [supabase])

  // ── Inferred / derived state ─────────────────────────────────
  const conn = connectionState(status, now)
  const positionQty = status?.position_qty ?? 0
  // position_side is the runner's authoritative answer; fall back to qty sign
  // so a missing side on an old row still renders correctly.
  const positionSide: 'LONG' | 'SHORT' | 'FLAT' =
    status?.position_side ??
    (positionQty > 0 ? 'LONG' : positionQty < 0 ? 'SHORT' : 'FLAT')
  const hasPosition = positionSide !== 'FLAT' && positionQty !== 0
  // Prefer paper_status.instrument; fall back to the most recent paper/live
  // trade when the column is null (older paper_status rows pre-migration).
  const inferredInstrument =
    status?.instrument ?? trades.find((t) => t.instrument)?.instrument ?? null

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
        positionSide={positionSide}
        inferredInstrument={inferredInstrument}
        sessionPnl={sessionPnl}
        now={now}
        inactive={inactive}
        rtState={rtState}
      />

      {!inactive && <ScheduleCountdown now={now} />}

      {statusError && (
        <ErrorBanner label="paper_status" message={statusError} />
      )}

      {!inactive && hasPosition && (
        <OpenPositionCard
          status={status}
          openPosition={openPosition}
          positionSide={positionSide}
          positionQty={positionQty}
          instrument={inferredInstrument}
          now={now}
        />
      )}

      {!inactive && <SlippageStats fills={fills} now={now} />}

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
  positionSide,
  inferredInstrument,
  sessionPnl,
  now,
  inactive,
  rtState,
}: {
  status: LivePaperStatus | null
  conn: ConnectionState
  hasPosition: boolean
  positionQty: number
  positionSide: 'LONG' | 'SHORT' | 'FLAT'
  inferredInstrument: string | null
  sessionPnl: number | null
  now: number
  inactive: boolean
  rtState: RealtimeChannelStates
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

        <div className="flex items-center gap-2">
          <RealtimePip state={rtState} />
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
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Position"
          value={
            hasPosition
              ? <span className="text-base">
                  <span className={positionSide === 'LONG' ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}>
                    {positionSide === 'LONG' ? 'Long' : 'Short'}
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
          value={
            status?.current_price == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className="text-base">
                  {Number(status.current_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
          }
          sub={status?.current_price == null ? 'awaiting bar' : 'last close'}
        />
        <StatCard
          label="Unrealized P&L"
          value={
            status?.unrealized_pnl == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className={cn('text-base', pnlClass(status.unrealized_pnl))}>
                  {fmtUsd(status.unrealized_pnl, { signed: true })}
                </span>
          }
          sub={!hasPosition ? 'flat' : undefined}
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

// ── Open position card (SL/TP, time in trade, distance) ──────────────────

// 5pt no-round stop is locked into band_tagging_current. If a strategy
// override ships, this number will need to come from config/event payload.
const STOP_POINTS = 5

// $ per point for futures we trade. Falls back to ES if the instrument
// string is unrecognized — surfacing dollar distances is informational, not
// a hot path, so a sensible fallback is better than rendering "—".
function pointValueForInstrument(instr: string | null | undefined): number {
  if (!instr) return 50
  const s = instr.toUpperCase()
  if (s.startsWith('MES')) return 5
  if (s.startsWith('ES')) return 50
  if (s.startsWith('MNQ')) return 2
  if (s.startsWith('NQ')) return 20
  return 50
}

function OpenPositionCard({
  status,
  openPosition,
  positionSide,
  positionQty,
  instrument,
  now,
}: {
  status: LivePaperStatus | null
  openPosition: LiveEvent | null
  positionSide: 'LONG' | 'SHORT' | 'FLAT'
  positionQty: number
  instrument: string | null
  now: number
}) {
  if (positionSide === 'FLAT') return null

  // Prefer paper_status.position_avg_price (always present when a position is
  // open) and fall back to the position_opened event for older rows.
  const eventEntry =
    openPosition?.data && typeof openPosition.data.entry_price === 'number'
      ? (openPosition.data.entry_price as number)
      : null
  const entryPrice = status?.position_avg_price ?? eventEntry
  const currentPrice = status?.current_price ?? null

  // Only trust the event timestamp if it's >= session start — otherwise it's
  // a stale position_opened from a prior session.
  const eventTs = openPosition?.ts ? new Date(openPosition.ts).getTime() : null
  const sessionStart = status?.started_at ? new Date(status.started_at).getTime() : null
  const tradeOpenedAt =
    eventTs != null && (sessionStart == null || eventTs >= sessionStart) ? eventTs : null

  const sl = entryPrice == null
    ? null
    : positionSide === 'LONG' ? entryPrice - STOP_POINTS : entryPrice + STOP_POINTS

  const ptValue = pointValueForInstrument(instrument)

  const distToStop = currentPrice == null || sl == null
    ? null
    : positionSide === 'LONG' ? currentPrice - sl : sl - currentPrice
  const distToStopDollars = distToStop == null ? null : distToStop * ptValue * Math.abs(positionQty)

  const timeInTradeMs = tradeOpenedAt == null ? null : now - tradeOpenedAt

  return (
    <section className="rounded border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Open position
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono">
          {tradeOpenedAt != null ? `in trade ${humanDelta(timeInTradeMs ?? 0)}` : 'in trade —'}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Entry"
          value={
            entryPrice == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className="text-base">{fmtPx(entryPrice)}</span>
          }
          sub={
            positionSide === 'LONG'
              ? <span className="text-[var(--positive)]">long {Math.abs(positionQty)}</span>
              : <span className="text-[var(--negative)]">short {Math.abs(positionQty)}</span>
          }
        />
        <StatCard
          label={`Stop loss (-${STOP_POINTS}pt)`}
          value={
            sl == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className="text-base text-[var(--negative)]">{fmtPx(sl)}</span>
          }
          sub={
            distToStop == null
              ? 'no current price'
              : <>
                  {fmtPxSigned(distToStop)} pt
                  <span className="text-muted-foreground/60"> · </span>
                  {fmtUsd(distToStopDollars, { signed: true })}
                </>
          }
        />
        <StatCard
          label="Take profit"
          value={<span className="text-base text-muted-foreground">midband ± 0.25</span>}
          sub="tracking (not in paper_status)"
        />
        <StatCard
          label="Current"
          value={
            currentPrice == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className="text-base">{fmtPx(currentPrice)}</span>
          }
          sub={tradeOpenedAt != null ? `opened ${fmtTradeTime(new Date(tradeOpenedAt).toISOString())}` : undefined}
        />
      </div>
    </section>
  )
}

// ── Slippage stats ───────────────────────────────────────────────────────

function SlippageStats({ fills }: { fills: LiveEvent[]; now: number }) {
  const todayStartMs = etTodayStartUtc().getTime()

  let todaySum = 0
  let todayN = 0
  let weekSum = 0
  let weekN = 0
  for (const f of fills) {
    const slip = numberFrom(f.data, 'slippage')
    if (slip == null) continue
    weekSum += Math.abs(slip)
    weekN += 1
    const ts = new Date(f.ts).getTime()
    if (Number.isFinite(ts) && ts >= todayStartMs) {
      todaySum += Math.abs(slip)
      todayN += 1
    }
  }
  const todayAvg = todayN > 0 ? todaySum / todayN : null
  const weekAvg = weekN > 0 ? weekSum / weekN : null

  // > $20/fill is the user's drift threshold ("if this stat drifts above
  // $20/fill, that's a signal something's wrong"). Color the today value.
  const driftCls = todayAvg != null && todayAvg > 20 ? 'text-[var(--negative)]' : ''

  return (
    <section className="rounded border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Slippage tracking
        </h2>
        <span className="text-[10px] text-muted-foreground font-mono">
          drift threshold $20/fill
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          label="Avg today"
          value={
            todayAvg == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className={cn('text-base', driftCls)}>{fmtUsd(todayAvg)}</span>
          }
          sub={todayN > 0 ? `${todayN} fill${todayN === 1 ? '' : 's'}` : 'no fills yet'}
        />
        <StatCard
          label="Avg last 7d"
          value={
            weekAvg == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className="text-base">{fmtUsd(weekAvg)}</span>
          }
          sub={weekN > 0 ? `${weekN} fill${weekN === 1 ? '' : 's'}` : 'no fills yet'}
        />
        <StatCard
          label="vs 7d baseline"
          value={
            todayAvg == null || weekAvg == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className={cn('text-base', todayAvg > weekAvg ? 'text-[var(--warning)]' : 'text-[var(--positive)]')}>
                  {todayAvg > weekAvg ? '+' : ''}{fmtUsd(todayAvg - weekAvg, { signed: true })}
                </span>
          }
          sub="today minus 7-day avg"
        />
      </div>
    </section>
  )
}

// ── Realtime channel pip ──────────────────────────────────────────────────

type ChannelStatus =
  | 'SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED'
  | string  // supabase-js types are loose; tolerate future values

type RealtimeChannelStates = {
  status: ChannelStatus
  trades: ChannelStatus
  events: ChannelStatus
}

function RealtimePip({ state }: { state: RealtimeChannelStates }) {
  const values = [state.status, state.trades, state.events]
  const allOk = values.every((s) => s === 'SUBSCRIBED')
  const anyError = values.some((s) => s === 'CHANNEL_ERROR' || s === 'CLOSED')
  const cls = allOk
    ? 'bg-[var(--positive)]'
    : anyError
      ? 'bg-[var(--negative)]'
      : 'bg-[var(--warning)]'
  const label = allOk ? 'Realtime live' : anyError ? 'Realtime down' : 'Realtime connecting'
  const detail = `status:${state.status} trades:${state.trades} events:${state.events}`
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
      title={detail}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', cls)} />
      RT
      <span className="sr-only">{label}</span>
    </span>
  )
}

// ── Schedule countdown ────────────────────────────────────────────────────

type ScheduleEntry = { etMin: number; label: string }

// ET-anchored runner schedule. Sorted ascending by minute-of-day. Used to
// compute the next transition and a countdown so a user glancing at the page
// knows whether the runner is about to go quiet, force-flat, or wake back up.
const SCHEDULE: ScheduleEntry[] = [
  { etMin:  3 * 60 + 0,  label: 'Trading window opens' },
  { etMin: 16 * 60 + 55, label: 'Force-flat' },
  { etMin: 17 * 60 + 0,  label: 'Globex break' },
  { etMin: 18 * 60 + 0,  label: 'Globex resume' },
]

function ScheduleCountdown({ now }: { now: number }) {
  const etMins = etMinutesOfDay(now)
  const next = SCHEDULE.find((s) => s.etMin > etMins) ?? SCHEDULE[0]
  const minutesUntil = next.etMin > etMins
    ? next.etMin - etMins
    : (24 * 60 - etMins) + next.etMin
  // Seconds resolution: pull from the now ticker for a 1Hz countdown.
  const secondsInThisMin = Math.floor((now / 1000) % 60)
  const secondsUntil = minutesUntil * 60 - secondsInThisMin

  return (
    <div className="rounded border border-border bg-card px-4 py-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
      <span className="text-muted-foreground">Next transition</span>
      <span>
        <span className="text-foreground">{next.label}</span>
        <span className="text-muted-foreground/60"> · </span>
        <span className="text-foreground">in {humanDelta(secondsUntil * 1000)}</span>
      </span>
    </div>
  )
}

// ── Format / time helpers ────────────────────────────────────────────────

function fmtPx(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPxSigned(n: number): string {
  const s = n >= 0 ? '+' : '-'
  return s + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function numberFrom(data: Record<string, unknown> | null, key: string): number | null {
  if (!data) return null
  const v = data[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function humanDelta(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// Minutes-to-add to a UTC instant to reach its America/New_York wall clock.
// EST → -300, EDT → -240.
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

function etMinutesOfDay(nowMs: number): number {
  const now = new Date(nowMs)
  const off = nyOffsetMinutes(now)
  const ny = new Date(now.getTime() + off * 60000)
  return ny.getUTCHours() * 60 + ny.getUTCMinutes()
}

// UTC instant for the most recent 00:00 America/New_York. DST-safe — the
// offset is resolved at NY-midnight, not at "now".
function etTodayStartUtc(): Date {
  const now = new Date()
  const offNow = nyOffsetMinutes(now)
  const nyNow = new Date(now.getTime() + offNow * 60000)
  const y = nyNow.getUTCFullYear()
  const m = nyNow.getUTCMonth()
  const d = nyNow.getUTCDate()
  const naiveMidnightUtc = Date.UTC(y, m, d, 0, 0, 0)
  const offAtMidnight = nyOffsetMinutes(new Date(naiveMidnightUtc))
  return new Date(naiveMidnightUtc - offAtMidnight * 60000)
}

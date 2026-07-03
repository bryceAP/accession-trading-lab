'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Radio, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  fmtUsd,
  pnlClass,
  relativeTime,
} from '../../backtests/_components/format'
import { ExitReasonBadge } from '../../backtests/_components/exit-reason'
import { fmtTradeTime } from '@/lib/format'
import {
  eventStyle,
  eventSummary,
  formatET,
  sourceStyle,
} from '../../activity/_components/styles'

// ── Constants ─────────────────────────────────────────────────────────────

// Runner writes paper_status on 5m closes (~300s cadence). > 390s = one
// missed bar past expected → "runner may be dead".
const STALE_MS = 390 * 1000

// Realtime resilience. If any channel is not SUBSCRIBED for this long, we
// consider realtime "down" and surface a nudge + start polling. Kept short
// enough that a routine drop-and-reconnect (few seconds) doesn't trip it.
const REALTIME_DOWN_GRACE_MS = 30 * 1000
const POLLING_FALLBACK_MS = 10 * 1000

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
  strategy_name: string | null
  side: string | null
  entry_price: number | null
  exit_price: number | null
  quantity: number | null
  pnl: number | null
  commission: number | null
  slippage: number | null
  exit_reason: string | null
  instrument: string | null
  source: string | null
  created_at: string | null
}

export type LiveEvent = {
  id: number
  ts: string
  event_type: string
  source: string
  data: Record<string, unknown> | null
}

// ── Numeric coercion ──────────────────────────────────────────────────────

// Postgres `numeric` columns arrive from supabase-js as strings to preserve
// precision. A naïve `t.pnl + acc` silently concatenates ("0" + "387.5" =
// "0387.5"), which has bitten the running-tally math. Use n() any time a
// numeric column is going into arithmetic.
function n(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const x = Number(v)
    return Number.isFinite(x) ? x : 0
  }
  return 0
}

// nOrNull preserves the "no value" state — some UI paths render "—" when a
// number is missing but 0 when it's genuinely zero. Callers that need that
// distinction should use this instead of n().
function nOrNull(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    if (v === '') return null
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }
  return null
}

// ── Connection-state derivation (heartbeat freshness) ─────────────────────

// The heartbeat pill is heartbeat-only. `paper_status.connection_state` (the
// IB session state as reported by the runner) is surfaced separately as
// RunnerStateBadge, so a wedged runner (heartbeats but IB down) and a dead
// runner (no heartbeats) render distinctly.

type ConnectionState = 'live' | 'stale' | 'stopped' | 'idle'

function connectionState(ps: LivePaperStatus | null, nowMs: number): ConnectionState {
  if (!ps) return 'idle'
  if (!ps.is_running) return 'stopped'
  if (!ps.last_heartbeat) return 'stale'
  const age = nowMs - new Date(ps.last_heartbeat).getTime()
  if (!Number.isFinite(age) || age >= STALE_MS) return 'stale'
  return 'live'
}

const CONNECTION_STYLES: Record<ConnectionState, { label: string; cls: string; dot: string }> = {
  live:    { label: 'Live',                       cls: 'border-[var(--positive)]/30 text-[var(--positive)] bg-[var(--positive)]/10', dot: 'bg-[var(--positive)] animate-pulse' },
  stale:   { label: 'Stale — runner may be dead', cls: 'border-[var(--negative)]/30 text-[var(--negative)] bg-[var(--negative)]/10', dot: 'bg-[var(--negative)]' },
  stopped: { label: 'Stopped',                    cls: 'border-border text-muted-foreground bg-muted/40', dot: 'bg-muted-foreground/40' },
  idle:    { label: 'No session',                 cls: 'border-border text-muted-foreground bg-muted/40', dot: 'bg-muted-foreground/30' },
}

function isSessionInactive(ps: LivePaperStatus | null, tradesCount: number): boolean {
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
  statusError,
  tradesError,
  eventsError,
}: {
  initialStatus: LivePaperStatus | null
  initialTrades: LiveTrade[]
  initialEvents: LiveEvent[]
  initialOpenPosition: LiveEvent | null
  statusError: string | null
  tradesError: string | null
  eventsError: string | null
}) {
  const supabase = useMemo(() => createClient(), [])

  const [status, setStatus] = useState<LivePaperStatus | null>(initialStatus)
  const [trades, setTrades] = useState<LiveTrade[]>(initialTrades)
  const [events, setEvents] = useState<LiveEvent[]>(initialEvents)
  const [openPosition, setOpenPosition] = useState<LiveEvent | null>(initialOpenPosition)
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

  // ── Trade merge helper (shared by realtime + polling paths) ─────────────
  const upsertTrade = useCallback((t: LiveTrade) => {
    if (!t || t.source !== 'paper') return
    setTrades((prev) => {
      const idx = prev.findIndex((x) => x.id === t.id)
      if (idx === -1) return [t, ...prev]
      const next = prev.slice()
      next[idx] = t
      return next
    })
  }, [])

  const flashTradeId = useCallback((id: string | number) => {
    setNewTradeIds((prev) => {
      const next = new Set(prev); next.add(id); return next
    })
    setTimeout(() => {
      setNewTradeIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev); next.delete(id); return next
      })
    }, 2500)
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
          upsertTrade(t)
          if (t?.id != null) flashTradeId(t.id)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trades', filter: 'source=eq.paper' },
        (payload) => {
          const t = payload.new as LiveTrade
          upsertTrade(t)
        },
      )
      .subscribe((s) => setRtState((prev) => ({ ...prev, trades: s })))
    return () => { supabase.removeChannel(ch) }
  }, [supabase, upsertTrade, flashTradeId])

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
          if (ev.source === 'paper') {
            if (ev.event_type === 'position_opened') {
              setOpenPosition(ev)
            } else if (ev.event_type === 'position_closed') {
              setOpenPosition(null)
            }
          }
          setNewEventIds((prev) => {
            const next = new Set(prev); next.add(ev.id); return next
          })
          setTimeout(() => {
            setNewEventIds((prev) => {
              if (!prev.has(ev.id)) return prev
              const next = new Set(prev); next.delete(ev.id); return next
            })
          }, 2500)
        },
      )
      .subscribe((s) => setRtState((prev) => ({ ...prev, events: s })))
    return () => { supabase.removeChannel(ch) }
  }, [supabase])

  // ── Realtime health ─────────────────────────────────────────
  const rtHealth: RealtimeHealth = useMemo(() => {
    const values = [rtState.status, rtState.trades, rtState.events]
    if (values.every((s) => s === 'SUBSCRIBED')) return 'live'
    if (values.some((s) => s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED')) return 'down'
    return 'connecting'
  }, [rtState])

  // Track when realtime first went unhealthy so we can grace a brief
  // reconnect (≤30s) before nagging the user.
  const rtUnhealthySinceRef = useRef<number | null>(null)
  useEffect(() => {
    if (rtHealth === 'live') {
      rtUnhealthySinceRef.current = null
    } else if (rtUnhealthySinceRef.current == null) {
      rtUnhealthySinceRef.current = Date.now()
    }
  }, [rtHealth])
  const rtDownDuration =
    rtUnhealthySinceRef.current != null ? now - rtUnhealthySinceRef.current : 0
  const rtHardDown = rtHealth !== 'live' && rtDownDuration >= REALTIME_DOWN_GRACE_MS

  // ── Polling fallback: only runs while realtime isn't fully live ─────────
  // Keeps paper_status + trades fresh so the UI never silently freezes when
  // the websocket drops. Stops as soon as realtime recovers.
  useEffect(() => {
    if (rtHealth === 'live') return
    let cancelled = false

    async function pollOnce() {
      try {
        const { data: ps } = await supabase
          .from('paper_status')
          .select(
            'id, strategy_name, is_running, started_at, last_heartbeat, ' +
            'connection_state, instrument, position_side, position_qty, ' +
            'position_avg_price, current_price, unrealized_pnl, daily_pnl, updated_at'
          )
          .eq('id', 1)
          .maybeSingle()
        if (cancelled) return
        if (ps) setStatus(ps as unknown as LivePaperStatus)

        const feedCutoffIso = etTodayStartMs()
        const { data: tr } = await supabase
          .from('trades')
          .select(
            'id, entry_ts, exit_ts, strategy_name, side, entry_price, exit_price, ' +
            'quantity, pnl, commission, slippage, exit_reason, instrument, source, created_at'
          )
          .eq('source', 'paper')
          .gte('exit_ts', feedCutoffIso)
          .order('exit_ts', { ascending: false })
          .limit(200)
        if (cancelled) return
        if (tr) {
          for (const row of tr as unknown as LiveTrade[]) upsertTrade(row)
        }
      } catch {
        // Swallow — we'll try again on the next tick.
      }
    }

    pollOnce()
    const id = setInterval(pollOnce, POLLING_FALLBACK_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [rtHealth, supabase, upsertTrade])

  // ── Inferred / derived state ─────────────────────────────────
  const conn = connectionState(status, now)
  const positionQty = n(status?.position_qty)
  const positionSide: 'LONG' | 'SHORT' | 'FLAT' =
    status?.position_side ??
    (positionQty > 0 ? 'LONG' : positionQty < 0 ? 'SHORT' : 'FLAT')
  const hasPosition = positionSide !== 'FLAT' && positionQty !== 0
  const inferredInstrument =
    status?.instrument ?? trades.find((t) => t.instrument)?.instrument ?? null

  const inactive = isSessionInactive(status, trades.length)

  return (
    <div className="space-y-5">
      {rtHardDown && (
        <RealtimeDownNudge downSeconds={Math.floor(rtDownDuration / 1000)} />
      )}

      <StatusPanel
        status={status}
        conn={conn}
        hasPosition={hasPosition}
        positionQty={positionQty}
        positionSide={positionSide}
        inferredInstrument={inferredInstrument}
        now={now}
        inactive={inactive}
        rtHealth={rtHealth}
      />

      {statusError && (
        <ErrorBanner label="paper_status" message={statusError} />
      )}

      {!inactive && <ScheduleCountdown now={now} />}

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

// ── Realtime-down nudge ───────────────────────────────────────────────────

function RealtimeDownNudge({ downSeconds }: { downSeconds: number }) {
  return (
    <div className="rounded border border-[var(--negative)]/40 bg-[var(--negative)]/10 px-3 py-2 text-[11px] text-[var(--negative)] flex items-start gap-2">
      <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <div>
          Realtime feed down {downSeconds}s. UI is polling every 10s as a
          fallback — data is fresh but delayed.
        </div>
        <div className="text-[10px] text-[var(--negative)]/80">
          Hard-refresh the tab if numbers still look frozen.
        </div>
      </div>
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
  now,
  inactive,
  rtHealth,
}: {
  status: LivePaperStatus | null
  conn: ConnectionState
  hasPosition: boolean
  positionQty: number
  positionSide: 'LONG' | 'SHORT' | 'FLAT'
  inferredInstrument: string | null
  now: number
  inactive: boolean
  rtHealth: RealtimeHealth
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
  const currentPrice = nOrNull(status?.current_price)

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
          <RealtimeHealthBadge health={rtHealth} />
          <RunnerStateBadge state={status?.connection_state ?? null} />
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
              ? `entry ${fmtPx(n(status.position_avg_price))}`
              : hasPosition
                ? undefined
                : 'no position'
          }
        />
        <StatCard
          label="Current price"
          value={
            currentPrice == null
              ? <span className="text-base text-muted-foreground">—</span>
              : <span className="text-base">{fmtPx(currentPrice)}</span>
          }
          sub={currentPrice == null ? 'awaiting bar' : 'last close'}
        />
        <StatCard
          label="Runner"
          value={<span className="text-base">{status?.is_running ? 'Active' : 'Idle'}</span>}
          sub={status?.updated_at ? `updated ${relativeTime(new Date(status.updated_at))}` : undefined}
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
        <div className="flex items-baseline gap-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Today&apos;s paper trades
          </h2>
          <span className="text-[10px] text-muted-foreground/70 font-mono">
            times in ET
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
          {trades.length}
        </span>
      </div>

      {error ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--negative)] font-mono">
          Query error: {error}
        </div>
      ) : trades.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground space-y-1">
          <div>No paper trades yet today.</div>
          <div className="text-[10px] text-muted-foreground/70">
            Filter: <span className="font-mono">trades.source = &apos;paper&apos; · exit_ts ≥ ET midnight</span>
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
                <th className="px-3 py-2 text-right font-semibold">Hold</th>
                <th className="px-3 py-2 text-right font-semibold">P&amp;L</th>
                <th className="px-3 py-2 text-right font-semibold">Slippage</th>
                <th className="px-3 py-2 text-left  font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const sideStr = (t.side ?? '').toUpperCase()
                const isShort = sideStr.startsWith('S')
                const sideClass = isShort ? 'text-[var(--negative)]' : 'text-[var(--positive)]'
                const isNew = newIds.has(t.id)
                const isOpen = t.exit_ts == null
                const pnlVal = nOrNull(t.pnl)
                const slipVal = nOrNull(t.slippage)
                const entryVal = nOrNull(t.entry_price)
                const exitVal = nOrNull(t.exit_price)
                const qtyVal = nOrNull(t.quantity)
                const holdMs =
                  t.entry_ts && t.exit_ts
                    ? new Date(t.exit_ts).getTime() - new Date(t.entry_ts).getTime()
                    : null
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
                      {sideStr || '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {qtyVal != null ? qtyVal.toLocaleString('en-US') : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {entryVal != null ? fmtPx(entryVal) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {exitVal != null ? fmtPx(exitVal) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                      {holdMs == null ? '—' : humanDelta(holdMs)}
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

  const eventEntry =
    openPosition?.data && typeof openPosition.data.entry_price === 'number'
      ? (openPosition.data.entry_price as number)
      : null
  const entryPrice = nOrNull(status?.position_avg_price) ?? eventEntry
  const currentPrice = nOrNull(status?.current_price)

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
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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

// ── Realtime channel labels ───────────────────────────────────────────────

type ChannelStatus =
  | 'SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED'
  | string

type RealtimeChannelStates = {
  status: ChannelStatus
  trades: ChannelStatus
  events: ChannelStatus
}

type RealtimeHealth = 'live' | 'connecting' | 'down'

function RunnerStateBadge({ state }: { state: LivePaperStatus['connection_state'] }) {
  const label = (state ?? 'unknown').toUpperCase()
  const cls =
    state === 'connected'
      ? 'text-[var(--positive)]'
      : state === 'disconnected'
        ? 'text-[var(--negative)]'
        : state === 'stopped'
          ? 'text-muted-foreground'
          : 'text-muted-foreground/60'
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground"
      title="paper_status.connection_state (what the runner reports about its IB session)"
    >
      runner:&nbsp;<span className={cls}>{label}</span>
    </span>
  )
}

// Only renders when the Realtime feed is in a problem state
// (connecting / down). When channels are healthy, the pill and runner
// badge already carry the "everything's up" signal — an extra green
// "RT live" chip read as a false-positive when the runner was actually
// off, so it's suppressed. If the websocket drops, this appears in
// yellow/red so the drop still surfaces.
function RealtimeHealthBadge({ health }: { health: RealtimeHealth }) {
  if (health === 'live') return null
  const { label, dot, cls } = REALTIME_STYLES[health]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest',
        cls,
      )}
      title="Supabase Realtime channel health"
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

const REALTIME_STYLES: Record<RealtimeHealth, { label: string; dot: string; cls: string }> = {
  live: {
    label: 'RT live',
    dot: 'bg-[var(--positive)] animate-pulse',
    cls: 'border-[var(--positive)]/30 text-[var(--positive)] bg-[var(--positive)]/10',
  },
  connecting: {
    label: 'RT reconnecting…',
    dot: 'bg-[var(--warning)] animate-pulse',
    cls: 'border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning)]/10',
  },
  down: {
    label: 'RT down',
    dot: 'bg-[var(--negative)]',
    cls: 'border-[var(--negative)]/30 text-[var(--negative)] bg-[var(--negative)]/10',
  },
}

// ── Schedule countdown ────────────────────────────────────────────────────

type ScheduleEntry = { etMin: number; label: string }

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

// ISO string for the most recent ET midnight. Used by the polling fallback
// so its cutoff matches the server-side page cutoff.
function etTodayStartMs(): string {
  const now = new Date()
  const off = nyOffsetMinutes(now)
  const ny = new Date(now.getTime() + off * 60000)
  const y = ny.getUTCFullYear()
  const m = ny.getUTCMonth()
  const d = ny.getUTCDate()
  const naiveMidnightUtc = Date.UTC(y, m, d, 0, 0, 0)
  const offAtMidnight = nyOffsetMinutes(new Date(naiveMidnightUtc))
  return new Date(naiveMidnightUtc - offAtMidnight * 60000).toISOString()
}

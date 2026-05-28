import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────

type PaperStatus = {
  strategy_name: string | null
  is_running: boolean
  started_at: string | null
  last_heartbeat: string | null
  position_qty: number | null
  position_avg_price: number | null
  daily_pnl: number | null
}

type Trade = { pnl: number | null }

type OverviewEvent = {
  id: number
  ts: string
  event_type: string
  source: string
  data: Record<string, unknown>
}

// ── Data fetching ──────────────────────────────────────────────────────────

async function getOverviewData() {
  const supabase = createClient()
  const now = new Date()

  // UTC calendar boundaries
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const weekStart  = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const [status, todayRes, weekRes, monthRes, eventsRes] = await Promise.all([
    supabase
      .from('paper_status')
      .select('strategy_name, is_running, started_at, last_heartbeat, position_qty, position_avg_price, daily_pnl')
      .eq('id', 1)
      .maybeSingle(),
    supabase.from('trades').select('pnl').eq('source', 'paper').not('exit_ts', 'is', null).gte('exit_ts', todayStart.toISOString()),
    supabase.from('trades').select('pnl').eq('source', 'paper').not('exit_ts', 'is', null).gte('exit_ts', weekStart.toISOString()),
    supabase.from('trades').select('pnl').eq('source', 'paper').not('exit_ts', 'is', null).gte('exit_ts', monthStart.toISOString()),
    supabase.from('events').select('id, ts, event_type, source, data').order('ts', { ascending: false }).limit(10),
  ])

  const errors = [status.error, todayRes.error, weekRes.error, monthRes.error, eventsRes.error].filter(Boolean)
  if (errors.length) console.error('[Overview]', errors)

  return {
    paperStatus:   status.data   as PaperStatus | null,
    todayTrades:  (todayRes.data  ?? []) as Trade[],
    weekTrades:   (weekRes.data   ?? []) as Trade[],
    monthTrades:  (monthRes.data  ?? []) as Trade[],
    recentEvents: (eventsRes.data ?? []) as OverviewEvent[],
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60)    return `${s}s ago`
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function formatET(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatPnl(n: number): string {
  return `${n >= 0 ? '+' : ''}$${Math.abs(n).toFixed(2)}`
}

function pnlClass(n: number): string {
  if (n > 0) return 'text-[var(--positive)]'
  if (n < 0) return 'text-[var(--negative)]'
  return 'text-muted-foreground'
}

function sumPnl(trades: Trade[]): number {
  return trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0)
}

function isHeartbeatFresh(ts: string | null): boolean {
  if (!ts) return false
  return Date.now() - new Date(ts).getTime() < 2 * 60 * 1000
}

function eventSummary(type: string, data: Record<string, unknown>): string {
  if (typeof data.message     === 'string') return data.message
  if (typeof data.description === 'string') return data.description
  if (typeof data.reason      === 'string') return data.reason

  if (type.startsWith('trade_')) {
    const parts: string[] = []
    const side = data.side as string | undefined
    const qty  = (data.qty ?? data.quantity) as number | undefined
    const inst = (data.instrument ?? data.symbol) as string | undefined
    const px   = (data.price ?? data.entry_price) as number | undefined
    const pnl  = data.pnl as number | undefined
    if (side) parts.push(side.toLowerCase())
    if (qty)  parts.push(String(qty))
    if (inst) parts.push(inst)
    if (px)   parts.push(`@ ${Number(px).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    if (pnl != null) parts.push(`· P&L ${pnl >= 0 ? '+' : ''}$${Number(pnl).toFixed(2)}`)
    if (parts.length) return parts.join(' ')
  }

  if (type === 'heartbeat') return typeof data.status === 'string' ? data.status : 'ok'

  const entries = Object.entries(data).slice(0, 3)
  if (!entries.length) return '—'
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join('  ·  ')
}

const EVENT_TYPE_STYLES: Record<string, { label: string; cls: string }> = {
  trade_open:    { label: 'OPEN',   cls: 'text-[var(--chart-1)]'  },
  trade_close:   { label: 'CLOSE',  cls: 'text-[var(--chart-2)]'  },
  signal:        { label: 'SIG',    cls: 'text-[var(--warning)]'  },
  error:         { label: 'ERR',    cls: 'text-[var(--negative)]' },
  heartbeat:     { label: 'HB',     cls: 'text-muted-foreground'  },
  status_change: { label: 'STATUS', cls: 'text-[var(--chart-5)]'  },
}

function eventStyle(type: string) {
  return EVENT_TYPE_STYLES[type] ?? {
    label: type.replace(/_/g, ' ').slice(0, 8).toUpperCase(),
    cls: 'text-muted-foreground',
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
        {children}
      </span>
      {right}
    </div>
  )
}

function StatCard({ label, value, sub }: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
}) {
  return (
    <div className="rounded border border-border bg-card px-4 py-3 space-y-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold tabular-nums leading-none">{value}</div>
      {sub != null && <div className="text-[10px] text-muted-foreground font-mono">{sub}</div>}
    </div>
  )
}

function StatusBanner({ ps }: { ps: PaperStatus | null }) {
  if (!ps) {
    return (
      <div className="flex items-center gap-2.5 rounded border border-border bg-card px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0" />
        <span className="text-xs text-muted-foreground">Paper trading not yet started.</span>
      </div>
    )
  }

  const running = ps.is_running && isHeartbeatFresh(ps.last_heartbeat)
  const hbDate  = ps.last_heartbeat ? new Date(ps.last_heartbeat) : null
  const startDate = ps.started_at ? new Date(ps.started_at) : null

  let timeLabel: string
  if (running && hbDate)       timeLabel = `last heartbeat ${relativeTime(hbDate)}`
  else if (hbDate)             timeLabel = `last active ${relativeTime(hbDate)}`
  else if (startDate)          timeLabel = `started ${relativeTime(startDate)}`
  else                         timeLabel = '—'

  return (
    <div className={`flex items-center justify-between rounded border px-4 py-3 ${
      running
        ? 'border-[var(--positive)]/20 bg-[var(--positive)]/5'
        : 'border-border bg-card'
    }`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full shrink-0 ${
          running ? 'bg-[var(--positive)] animate-pulse' : 'bg-muted-foreground/30'
        }`} />
        <span className={`text-xs font-semibold tracking-wider ${
          running ? 'text-[var(--positive)]' : 'text-muted-foreground'
        }`}>
          {running ? 'RUNNING' : 'STOPPED'}
        </span>
        {ps.strategy_name && (
          <>
            <span className="text-muted-foreground/30 select-none">·</span>
            <span className="text-xs text-muted-foreground">{ps.strategy_name}</span>
          </>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground font-mono">{timeLabel}</span>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function OverviewPage() {
  const { paperStatus, todayTrades, weekTrades, monthTrades, recentEvents } = await getOverviewData()

  const todayPnl  = sumPnl(todayTrades)
  const weekPnl   = sumPnl(weekTrades)
  const monthPnl  = sumPnl(monthTrades)

  const qty      = paperStatus?.position_qty ?? 0
  const avgPrice = paperStatus?.position_avg_price
  const posValue =
    qty === 0
      ? <span className="text-base text-muted-foreground">Flat</span>
      : <span className="text-base">{qty > 0 ? 'Long' : 'Short'} {Math.abs(qty)}</span>
  const posSub = qty !== 0 && avgPrice != null
    ? `MES @ ${Number(avgPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : undefined

  return (
    <div className="p-6 max-w-4xl space-y-5">

      {/* ── System status ─────────────────────────────────────── */}
      <StatusBanner ps={paperStatus} />

      {/* ── Today snapshot ────────────────────────────────────── */}
      <div>
        <SectionLabel>Today</SectionLabel>
        <div className="grid grid-cols-4 gap-2.5">
          <StatCard
            label="Position"
            value={posValue}
            sub={posSub}
          />
          <StatCard
            label="Daily P&L"
            value={
              todayTrades.length
                ? <span className={`text-xl ${pnlClass(todayPnl)}`}>{formatPnl(todayPnl)}</span>
                : <span className="text-xl text-muted-foreground">—</span>
            }
            sub={todayTrades.length ? `${todayTrades.length} trade${todayTrades.length !== 1 ? 's' : ''}` : 'No trades today'}
          />
          <StatCard
            label="Trades today"
            value={<span className="text-xl">{todayTrades.length}</span>}
          />
          <StatCard
            label="Live strategy"
            value={
              <span className={`text-sm ${paperStatus?.strategy_name ? '' : 'text-muted-foreground'}`}>
                {paperStatus?.strategy_name ?? '—'}
              </span>
            }
            sub={
              paperStatus?.started_at && paperStatus.is_running
                ? `since ${relativeTime(new Date(paperStatus.started_at))}`
                : undefined
            }
          />
        </div>
      </div>

      {/* ── Performance ───────────────────────────────────────── */}
      <div>
        <SectionLabel>Performance</SectionLabel>
        <div className="grid grid-cols-4 gap-2.5">
          <StatCard
            label="This week P&L"
            value={
              weekTrades.length
                ? <span className={`text-xl ${pnlClass(weekPnl)}`}>{formatPnl(weekPnl)}</span>
                : <span className="text-xl text-muted-foreground">—</span>
            }
            sub={weekTrades.length ? `${weekTrades.length} trades` : 'No trades'}
          />
          <StatCard
            label="This week trades"
            value={<span className="text-xl">{weekTrades.length}</span>}
          />
          <StatCard
            label="This month P&L"
            value={
              monthTrades.length
                ? <span className={`text-xl ${pnlClass(monthPnl)}`}>{formatPnl(monthPnl)}</span>
                : <span className="text-xl text-muted-foreground">—</span>
            }
            sub={monthTrades.length ? `${monthTrades.length} trades` : 'No trades'}
          />
          <StatCard
            label="This month trades"
            value={<span className="text-xl">{monthTrades.length}</span>}
          />
        </div>
      </div>

      {/* ── Recent activity ───────────────────────────────────── */}
      <div>
        <SectionLabel
          right={
            <Link href="/activity" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </Link>
          }
        >
          Recent activity
        </SectionLabel>

        <div className="rounded border border-border bg-card overflow-hidden">
          {recentEvents.length === 0 ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">No events recorded yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {recentEvents.map((ev) => {
                const { label, cls } = eventStyle(ev.event_type)
                return (
                  <div
                    key={ev.id}
                    className="flex items-baseline gap-3 px-4 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-[72px]">
                      {formatET(ev.ts)}
                    </span>
                    <span className={`font-mono text-[10px] font-bold tracking-wider shrink-0 w-12 ${cls}`}>
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {eventSummary(ev.event_type, ev.data)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

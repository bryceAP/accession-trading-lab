import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'

async function getOverviewCounts() {
  const supabase = createClient()
  const [strategies, events, status] = await Promise.all([
    supabase.from('strategies').select('*', { count: 'exact', head: true }),
    supabase.from('events').select('*', { count: 'exact', head: true }),
    supabase.from('paper_status').select('*').eq('id', 1).single(),
  ])
  return {
    strategyCount: strategies.count ?? 0,
    eventCount: events.count ?? 0,
    paperStatus: status.data,
    error: strategies.error ?? events.error ?? status.error,
  }
}

export default async function OverviewPage() {
  const { strategyCount, eventCount, paperStatus, error } = await getOverviewCounts()

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Overview</h1>
        {error ? (
          <Badge variant="destructive" className="text-xs">DB error</Badge>
        ) : (
          <Badge variant="outline" className="text-xs border-positive/40 text-positive">
            Connected
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Strategies" value={strategyCount} />
        <StatCard label="Events" value={eventCount} />
        <StatCard
          label="Paper Trading"
          value={paperStatus?.is_running ? 'Running' : 'Stopped'}
          valueClass={paperStatus?.is_running ? 'text-positive' : 'text-muted-foreground'}
        />
      </div>

      {paperStatus && (
        <div className="rounded border border-border bg-card p-4 space-y-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Paper Status
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
            <Row label="Strategy"    value={paperStatus.strategy_name ?? '—'} />
            <Row label="Position"    value={String(paperStatus.position_qty ?? 0)} mono />
            <Row label="Daily P&L"   value={paperStatus.daily_pnl != null ? `$${Number(paperStatus.daily_pnl).toFixed(2)}` : '—'} mono
              valueClass={
                (paperStatus.daily_pnl ?? 0) > 0
                  ? 'text-positive'
                  : (paperStatus.daily_pnl ?? 0) < 0
                  ? 'text-negative'
                  : ''
              }
            />
            <Row label="Last Heartbeat" value={paperStatus.last_heartbeat ? new Date(paperStatus.last_heartbeat).toLocaleTimeString() : '—'} mono />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Full overview coming soon. Row counts confirm Supabase connectivity.
      </p>
    </div>
  )
}

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string | number
  valueClass?: string
}) {
  return (
    <div className="rounded border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-mono font-semibold tabular-nums ${valueClass ?? ''}`}>
        {value}
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
  valueClass,
}: {
  label: string
  value: string
  mono?: boolean
  valueClass?: string
}) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? 'font-mono tabular-nums' : ''} ${valueClass ?? ''}`}>{value}</span>
    </>
  )
}

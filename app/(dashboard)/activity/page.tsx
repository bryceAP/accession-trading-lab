import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { fetchStrategyNameMap, type StrategyNameInfo } from '@/lib/strategy-names'
import { ActivityLog, type ActivityEvent } from './_components/activity-log'

const PAGE_SIZE = 50

export default async function ActivityPage() {
  const supabase = createClient()

  // Distinct event_type / source values for the filter chips. Sampled from
  // the last 5000 rows (ordered by ts desc) — a full-table scan grows
  // unboundedly as live trading emits events and eventually made the page
  // load slow enough to feel broken. If a rare event type stops appearing
  // in that sample, it drops off the chips — acceptable trade-off since
  // chips are for current-navigation, not historical archaeology.
  const FILTER_SAMPLE = 5000
  const [eventsRes, typesRes, sourcesRes, strategyMap] = await Promise.all([
    supabase
      .from('events')
      .select('id, ts, event_type, source, data')
      .order('ts', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE),
    supabase
      .from('events')
      .select('event_type')
      .order('ts', { ascending: false })
      .limit(FILTER_SAMPLE),
    supabase
      .from('events')
      .select('source')
      .order('ts', { ascending: false })
      .limit(FILTER_SAMPLE),
    fetchStrategyNameMap(supabase),
  ])

  const strategyDirectory: Record<string, StrategyNameInfo> = {}
  strategyMap.forEach((info, key) => {
    strategyDirectory[key] = info
  })

  const errs = [eventsRes.error, typesRes.error, sourcesRes.error].filter(Boolean)
  if (errs.length) console.error('[Activity]', errs)

  const initialEvents = (eventsRes.data ?? []) as ActivityEvent[]
  const knownEventTypes = Array.from(
    new Set(((typesRes.data ?? []) as { event_type: string }[]).map((r) => r.event_type)),
  )
  const knownSources = Array.from(
    new Set(((sourcesRes.data ?? []) as { source: string }[]).map((r) => r.source)),
  )

  return (
    <div className="p-6 space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold tracking-tight">Activity</h1>
        {eventsRes.error ? (
          <Badge variant="destructive" className="text-xs">DB error</Badge>
        ) : null}
      </div>

      <ActivityLog
        initialEvents={initialEvents}
        knownEventTypes={knownEventTypes}
        knownSources={knownSources}
        strategyDirectory={strategyDirectory}
      />
    </div>
  )
}

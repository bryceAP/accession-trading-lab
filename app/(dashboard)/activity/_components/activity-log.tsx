'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  EVENT_TYPE_STYLES,
  eventStyle,
  eventSummary,
  formatET,
  sourceStyle,
} from './styles'

export type ActivityEvent = {
  id: number
  ts: string
  event_type: string
  source: string
  data: Record<string, unknown> | null
}

const PAGE_SIZE = 50
const HIGHLIGHT_MS = 2500

type Filters = {
  types: Set<string>
  sources: Set<string>
  dateFrom: string
  dateTo: string
}

function emptyFilters(): Filters {
  return { types: new Set(), sources: new Set(), dateFrom: '', dateTo: '' }
}

function dateFromIso(d: string): string | null {
  if (!d) return null
  // Treat the picked calendar date as UTC midnight start.
  return `${d}T00:00:00.000Z`
}

function dateToIso(d: string): string | null {
  if (!d) return null
  return `${d}T23:59:59.999Z`
}

function findScrollRoot(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null
  while (cur) {
    const overflow = getComputedStyle(cur).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return cur
    cur = cur.parentElement
  }
  return null
}

function matchesFilters(e: ActivityEvent, f: Filters): boolean {
  if (f.types.size > 0 && !f.types.has(e.event_type)) return false
  if (f.sources.size > 0 && !f.sources.has(e.source)) return false
  if (f.dateFrom) {
    const from = dateFromIso(f.dateFrom)
    if (from && e.ts < from) return false
  }
  if (f.dateTo) {
    const to = dateToIso(f.dateTo)
    if (to && e.ts > to) return false
  }
  return true
}

export function ActivityLog({
  initialEvents,
  knownEventTypes,
  knownSources,
}: {
  initialEvents: ActivityEvent[]
  knownEventTypes: string[]
  knownSources: string[]
}) {
  const supabase = useMemo(() => createClient(), [])

  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(initialEvents.length === PAGE_SIZE)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [newIds, setNewIds] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const [discoveredTypes, setDiscoveredTypes] = useState<Set<string>>(
    () => new Set([...knownEventTypes, ...initialEvents.map((e) => e.event_type)]),
  )
  const [discoveredSources, setDiscoveredSources] = useState<Set<string>>(
    () => new Set([...knownSources, ...initialEvents.map((e) => e.source)]),
  )

  // Refs so the realtime subscription always sees the latest filter state
  // without forcing a re-subscription on every filter change.
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const eventsRef = useRef(events)
  eventsRef.current = events

  // ── Fetch a page from Supabase ─────────────────────────────────
  const fetchPage = useCallback(
    async ({ before, append }: { before?: string; append: boolean }) => {
      const f = filtersRef.current
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)

      let q = supabase
        .from('events')
        .select('id, ts, event_type, source, data')
        .order('ts', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE)

      if (f.types.size > 0) q = q.in('event_type', Array.from(f.types))
      if (f.sources.size > 0) q = q.in('source', Array.from(f.sources))
      const from = dateFromIso(f.dateFrom)
      const to = dateToIso(f.dateTo)
      if (from) q = q.gte('ts', from)
      if (to) q = q.lte('ts', to)
      if (before) q = q.lt('ts', before)

      const { data, error: qError } = await q

      if (qError) {
        console.error('[ActivityLog fetch]', qError)
        setError(qError.message)
        if (append) setLoadingMore(false)
        else setLoading(false)
        return
      }

      const rows = (data ?? []) as ActivityEvent[]

      setEvents((prev) => {
        if (!append) return rows
        // De-dupe in case of race with realtime.
        const seen = new Set(prev.map((e) => e.id))
        return [...prev, ...rows.filter((r) => !seen.has(r.id))]
      })
      setHasMore(rows.length === PAGE_SIZE)
      // Grow the discovered chip set.
      setDiscoveredTypes((prev) => {
        const next = new Set(prev)
        rows.forEach((r) => next.add(r.event_type))
        return next
      })
      setDiscoveredSources((prev) => {
        const next = new Set(prev)
        rows.forEach((r) => next.add(r.source))
        return next
      })
      if (append) setLoadingMore(false)
      else setLoading(false)
    },
    [supabase],
  )

  // ── Refetch from scratch when filters change ───────────────────
  // Skip the very first render (we already have initialEvents).
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    fetchPage({ append: false })
  }, [filters, fetchPage])

  // ── Realtime subscription ──────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('public:events:activity-log')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        (payload) => {
          const ev = payload.new as ActivityEvent
          if (!ev || ev.id == null) return

          setDiscoveredTypes((prev) => {
            if (prev.has(ev.event_type)) return prev
            const next = new Set(prev)
            next.add(ev.event_type)
            return next
          })
          setDiscoveredSources((prev) => {
            if (prev.has(ev.source)) return prev
            const next = new Set(prev)
            next.add(ev.source)
            return next
          })

          if (!matchesFilters(ev, filtersRef.current)) return
          if (eventsRef.current.some((e) => e.id === ev.id)) return

          setEvents((prev) => [ev, ...prev])
          setNewIds((prev) => {
            const next = new Set(prev)
            next.add(ev.id)
            return next
          })

          setTimeout(() => {
            setNewIds((prev) => {
              if (!prev.has(ev.id)) return prev
              const next = new Set(prev)
              next.delete(ev.id)
              return next
            })
          }, HIGHLIGHT_MS)
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  // ── Infinite scroll sentinel ───────────────────────────────────
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    if (!hasMore || loading || loadingMore) return
    const root = findScrollRoot(el)
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        const last = eventsRef.current[eventsRef.current.length - 1]
        if (!last) return
        fetchPage({ before: last.ts, append: true })
      },
      { root, rootMargin: '200px 0px', threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loading, loadingMore, events.length, fetchPage])

  // ── Filter handlers ────────────────────────────────────────────
  function toggleType(t: string) {
    setFilters((f) => {
      const next = new Set(f.types)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return { ...f, types: next }
    })
  }

  function toggleSource(s: string) {
    setFilters((f) => {
      const next = new Set(f.sources)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return { ...f, sources: next }
    })
  }

  function clearFilters() {
    setFilters(emptyFilters())
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasActiveFilters =
    filters.types.size > 0 ||
    filters.sources.size > 0 ||
    !!filters.dateFrom ||
    !!filters.dateTo

  const typeChips = useMemo(() => {
    // Preserve a stable order: known set sorted; types from EVENT_TYPE_STYLES first.
    const known = Object.keys(EVENT_TYPE_STYLES)
    const seen = Array.from(discoveredTypes).sort()
    const ordered = [...known.filter((k) => discoveredTypes.has(k)), ...seen.filter((s) => !known.includes(s))]
    return ordered
  }, [discoveredTypes])

  const sourceChips = useMemo(
    () => Array.from(discoveredSources).sort(),
    [discoveredSources],
  )

  return (
    <div className="space-y-4">
      {/* ── Filters ────────────────────────────────────────── */}
      <div className="rounded border border-border bg-card p-3 space-y-3">
        <FilterGroup label="Event type">
          {typeChips.length === 0 ? (
            <span className="text-[10px] text-muted-foreground">—</span>
          ) : (
            typeChips.map((t) => {
              const style = eventStyle(t)
              const active = filters.types.has(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={cn(
                    'h-6 rounded border px-2 text-[10px] font-mono font-bold tracking-wider transition-colors',
                    active
                      ? 'border-foreground/40 bg-muted/60 text-foreground'
                      : 'border-border bg-card hover:bg-muted/40',
                    !active && style.cls,
                  )}
                  title={t}
                >
                  {style.label}
                </button>
              )
            })
          )}
        </FilterGroup>

        <FilterGroup label="Source">
          {sourceChips.length === 0 ? (
            <span className="text-[10px] text-muted-foreground">—</span>
          ) : (
            sourceChips.map((s) => {
              const active = filters.sources.has(s)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSource(s)}
                  className={cn(
                    'h-6 rounded border px-2 text-[10px] font-mono tracking-wider transition-colors',
                    active
                      ? 'border-foreground/40 bg-muted/60 text-foreground'
                      : sourceStyle(s),
                  )}
                >
                  {s}
                </button>
              )
            })
          )}
        </FilterGroup>

        <FilterGroup label="Date range">
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            className="h-7 rounded border border-border bg-card px-2 text-xs font-mono text-foreground focus:outline-none focus:border-ring"
          />
          <span className="text-[10px] text-muted-foreground">→</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            className="h-7 rounded border border-border bg-card px-2 text-xs font-mono text-foreground focus:outline-none focus:border-ring"
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 h-6 rounded border border-border bg-card px-2 text-[10px] text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </FilterGroup>
      </div>

      {/* ── Status line ────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono tabular-nums">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--positive)] animate-pulse" />
          <span>Live</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{events.length} loaded{hasMore ? '+' : ''}</span>
        </div>
        {error && <span className="text-[var(--negative)]">{error}</span>}
      </div>

      {/* ── Events list ────────────────────────────────────── */}
      <div className="rounded border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            {hasActiveFilters ? 'No events match the current filters.' : 'No events recorded yet.'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {events.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                expanded={expanded.has(ev.id)}
                isNew={newIds.has(ev.id)}
                onToggle={() => toggleExpand(ev.id)}
              />
            ))}
          </div>
        )}

        {/* Sentinel + load-more fallback */}
        <div ref={sentinelRef} />
        {hasMore && !loading && (
          <div className="border-t border-border px-4 py-2.5 flex items-center justify-center">
            <button
              type="button"
              onClick={() => {
                const last = events[events.length - 1]
                if (!last) return
                fetchPage({ before: last.ts, append: true })
              }}
              disabled={loadingMore}
              className="h-7 rounded border border-border bg-card px-3 text-[11px] text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground w-[88px] shrink-0">
        {label}
      </span>
      {children}
    </div>
  )
}

function EventRow({
  ev,
  expanded,
  isNew,
  onToggle,
}: {
  ev: ActivityEvent
  expanded: boolean
  isNew: boolean
  onToggle: () => void
}) {
  const style = eventStyle(ev.event_type)
  const Chev = expanded ? ChevronDown : ChevronRight
  return (
    <div
      className={cn(
        'transition-colors',
        isNew && 'bg-[var(--positive)]/10 animate-pulse',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-baseline gap-3 px-4 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        <Chev className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground self-center" />
        <span
          className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0 w-[112px]"
          title={ev.ts}
        >
          {formatET(ev.ts)}
        </span>
        <span className={cn('font-mono text-[10px] font-bold tracking-wider shrink-0 w-12', style.cls)}>
          {style.label}
        </span>
        <span
          className={cn(
            'inline-flex items-center h-4 rounded border px-1.5 text-[9px] font-mono uppercase tracking-wider shrink-0',
            sourceStyle(ev.source),
          )}
        >
          {ev.source}
        </span>
        <span className="text-xs text-foreground/85 truncate flex-1 min-w-0">
          {eventSummary(ev.event_type, ev.data)}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 pl-[152px]">
          <pre className="text-[11px] font-mono leading-relaxed text-muted-foreground bg-background border border-border rounded p-2.5 overflow-x-auto">
{JSON.stringify(ev.data ?? {}, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

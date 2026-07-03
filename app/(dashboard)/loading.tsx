// Route-group loading state. Applies to any child route in (dashboard)
// (Overview, /live, /activity, /backtests, /strategies, ...) while a
// server-rendered page waits on Supabase. Without this, slow queries
// leave the shell rendered but the content area blank — feels broken.
//
// Kept minimal on purpose: a subtle "loading…" line plus a few skeleton
// bars. If a specific page wants a richer skeleton it can override with
// its own loading.tsx at the leaf.

export default function DashboardLoading() {
  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-24 rounded bg-muted animate-pulse" />
        <div className="h-3 w-40 rounded bg-muted/60 animate-pulse" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="rounded border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="h-3 w-32 rounded bg-muted animate-pulse" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-muted animate-pulse" />
              <div className="h-3 flex-1 rounded bg-muted/60 animate-pulse" />
              <div className="h-3 w-16 rounded bg-muted/40 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground font-mono">Loading…</div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded border border-border bg-card px-3 py-2.5 space-y-2">
      <div className="h-2 w-16 rounded bg-muted/60 animate-pulse" />
      <div className="h-5 w-24 rounded bg-muted animate-pulse" />
      <div className="h-2 w-20 rounded bg-muted/40 animate-pulse" />
    </div>
  )
}

'use client'

// Route-group error boundary. Applies to any child route in (dashboard)
// that throws during render — a broken Supabase column, a null-deref in a
// component, a 500 from an RPC — instead of the whole app blanking. Reset
// re-invokes the segment's server render, which is usually enough to
// recover from transient DB flakes.

import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface for Vercel logs — the client-side stack has line info that
    // the Next.js error page swallows in production.
    console.error('[Dashboard error boundary]', error)
  }, [error])

  return (
    <div className="p-6 max-w-[1400px] space-y-4">
      <div className="rounded border border-[var(--negative)]/40 bg-[var(--negative)]/10 p-6 space-y-3">
        <div className="flex items-center gap-2 text-[var(--negative)]">
          <TriangleAlert className="h-4 w-4" />
          <h1 className="text-sm font-semibold">Something broke on this page.</h1>
        </div>
        <div className="text-xs text-[var(--negative)]/80 space-y-1">
          <div className="font-mono">{error.message || 'Unknown error'}</div>
          {error.digest && (
            <div className="text-[10px] text-[var(--negative)]/60 font-mono">
              digest: {error.digest}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center rounded border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center rounded border border-transparent px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to Overview
          </a>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { Archive, ArchiveRestore } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_OPTIONS, STATUS_STYLES, isStatus } from './status'
import { updateStrategyStatus } from './actions'

export function StatusControl({
  strategyId,
  initial,
}: {
  strategyId: string
  initial: string | null
}) {
  const [status, setStatus] = useState<string | null>(initial)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function setTo(next: string) {
    if (next === status) return
    setError(null)
    const prev = status
    setStatus(next) // optimistic
    startTransition(async () => {
      const res = await updateStrategyStatus(strategyId, next)
      if (!res.ok) {
        setStatus(prev)
        setError(
          res.error === 'unauthorized' ? 'Not signed in.' :
          res.error === 'invalid_status' ? 'Invalid status.' :
          'Could not update status.',
        )
      }
    })
  }

  const currentStyle = isStatus(status) ? STATUS_STYLES[status] : null
  const archived = status === 'archived'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-widest">Status</span>
        <span className="relative inline-block">
          <select
            value={status ?? ''}
            onChange={(e) => setTo(e.target.value)}
            disabled={pending}
            className={cn(
              'h-7 rounded border px-2 pr-7 text-xs font-medium uppercase tracking-wider appearance-none cursor-pointer focus:outline-none focus:border-ring',
              currentStyle?.cls ?? 'border-border bg-card text-foreground',
              pending && 'opacity-50',
            )}
          >
            {!isStatus(status) && status && <option value={status}>{status}</option>}
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{STATUS_STYLES[s].label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] opacity-60">▾</span>
        </span>
      </label>

      <button
        type="button"
        onClick={() => setTo(archived ? 'draft' : 'archived')}
        disabled={pending}
        className={cn(
          'inline-flex items-center gap-1.5 h-7 rounded border border-border bg-card px-2.5 text-xs hover:bg-muted/50 transition-colors disabled:opacity-50',
        )}
      >
        {archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
        {archived ? 'Unarchive' : 'Archive'}
      </button>

      {error && <span className="text-[10px] text-[var(--negative)]">{error}</span>}
      {pending && <span className="text-[10px] text-muted-foreground">Saving…</span>}
    </div>
  )
}

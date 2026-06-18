'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { updateStrategyDisplayName } from './actions'

const MAX_LEN = 80

// Inline editor for the strategy detail header. Pencil → input → save/cancel.
// Empty input clears display_name (falls back to programmatic name in the UI).
// Server action enforces the same constraints; client-side validation here is
// just to keep the affordance honest.
export function DisplayNameEditor({
  strategyId,
  initialDisplayName,
  fallbackName,
}: {
  strategyId: string
  initialDisplayName: string | null
  fallbackName: string
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(initialDisplayName ?? '')
  const [serverValue, setServerValue] = useState(initialDisplayName)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep local state in sync if the server-rendered prop changes (e.g.
  // after another tab updates the same strategy and we re-fetch).
  useEffect(() => {
    setServerValue(initialDisplayName)
    if (!open) setValue(initialDisplayName ?? '')
  }, [initialDisplayName, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const primary = serverValue?.trim() || fallbackName

  function cancel() {
    if (pending) return
    setValue(serverValue ?? '')
    setOpen(false)
    setError(null)
  }

  function save() {
    if (pending) return
    const trimmed = value.trim()
    if (trimmed.length > MAX_LEN) {
      setError(`Max ${MAX_LEN} characters.`)
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await updateStrategyDisplayName(strategyId, trimmed)
      if (!res.ok) {
        setError(
          res.error === 'unauthorized' ? 'Not signed in.' :
          res.error === 'too_long' ? `Max ${MAX_LEN} characters.` :
          'Could not save.',
        )
        return
      }
      setServerValue(trimmed || null)
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <span className="group inline-flex items-center gap-1.5 min-w-0">
        <h1 className="text-sm font-semibold tracking-tight truncate">{primary}</h1>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-foreground cursor-pointer"
          aria-label="Rename strategy"
          title="Rename"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') cancel()
        }}
        maxLength={MAX_LEN + 20}
        disabled={pending}
        placeholder={fallbackName}
        className={cn(
          'h-7 w-[280px] max-w-full rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:border-ring',
          error && 'border-[var(--negative)]/60',
        )}
      />
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="inline-flex items-center justify-center h-6 w-6 rounded border border-foreground/30 bg-foreground/10 text-foreground hover:bg-foreground/20 transition-colors disabled:opacity-50"
        aria-label="Save"
        title="Save"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={pending}
        className="inline-flex items-center justify-center h-6 w-6 rounded border border-border bg-card text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        aria-label="Cancel"
        title="Cancel"
      >
        <X className="h-3 w-3" />
      </button>
      {error && (
        <span className="text-[10px] text-[var(--negative)] font-mono ml-1">{error}</span>
      )}
    </span>
  )
}

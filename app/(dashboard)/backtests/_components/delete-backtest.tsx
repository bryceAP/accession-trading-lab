'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteBacktest } from './actions'

const CONFIRM_TOKEN = 'DELETE'

export function DeleteBacktest({
  backtestId,
  backtestLabel,
  tradeCount,
}: {
  backtestId: string
  backtestLabel: string
  tradeCount: number
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const canDelete = typed.trim() === CONFIRM_TOKEN && !pending

  function close() {
    if (pending) return
    setOpen(false)
    setTyped('')
    setError(null)
  }

  function confirm() {
    if (!canDelete) return
    setError(null)
    startTransition(async () => {
      // Server action redirects to /backtests on success;
      // we only see a return value on failure.
      const res = await deleteBacktest(backtestId)
      if (res && !res.ok) {
        setError(
          res.error === 'unauthorized' ? 'Not signed in.' :
          res.error === 'delete_trades_failed' ? 'Could not delete trades.' :
          res.error === 'delete_notes_failed' ? 'Could not delete notes.' :
          'Could not delete backtest.',
        )
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-7 rounded border border-[var(--negative)]/30 bg-[var(--negative)]/10 px-2.5 text-xs text-[var(--negative)] hover:bg-[var(--negative)]/20 transition-colors cursor-pointer"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete backtest
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
          onClick={close}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded border border-border bg-popover p-5 space-y-4 shadow-xl"
          >
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">Delete backtest?</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This will permanently delete <span className="font-mono text-foreground">{backtestLabel}</span>
                {tradeCount > 0 && (
                  <>
                    {' '}along with its{' '}
                    <span className="text-[var(--warning)]">
                      {tradeCount.toLocaleString()} trade{tradeCount === 1 ? '' : 's'}
                    </span>
                  </>
                )}
                {' '}and any attached notes. This cannot be undone.
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Type <span className="font-mono text-foreground">{CONFIRM_TOKEN}</span> to confirm
              </span>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={CONFIRM_TOKEN}
                autoFocus
                disabled={pending}
                className="w-full h-8 rounded border border-border bg-background px-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-ring disabled:opacity-50"
              />
            </label>

            {error && (
              <div className="text-[11px] text-[var(--negative)]">{error}</div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="h-7 rounded border border-border bg-card px-3 text-xs hover:bg-muted/50 transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={!canDelete}
                className="h-7 rounded border border-[var(--negative)]/40 bg-[var(--negative)]/15 px-3 text-xs text-[var(--negative)] hover:bg-[var(--negative)]/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {pending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

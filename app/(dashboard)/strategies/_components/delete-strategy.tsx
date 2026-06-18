'use client'

import { useEffect, useState, useTransition } from 'react'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  archiveStrategy,
  deleteStrategy,
  getStrategyDeletePreview,
  unarchiveStrategy,
} from './actions'

const CONFIRM_TOKEN = 'DELETE'

export function StrategyRowActions({
  strategyId,
  strategyName,
  archivedAt,
}: {
  strategyId: string
  strategyName: string
  archivedAt: string | null
}) {
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {archivedAt ? (
        <UnarchiveButton strategyId={strategyId} />
      ) : (
        <button
          type="button"
          onClick={() => setArchiveOpen(true)}
          className="inline-flex items-center gap-1.5 h-7 rounded border border-border bg-card px-2.5 text-xs text-foreground/80 hover:bg-muted/50 hover:text-foreground transition-colors"
        >
          <Archive className="h-3.5 w-3.5" />
          Archive
        </button>
      )}
      <button
        type="button"
        onClick={() => setDeleteOpen(true)}
        className="inline-flex items-center gap-1.5 h-7 rounded border border-[var(--negative)]/30 bg-[var(--negative)]/10 px-2.5 text-xs text-[var(--negative)] hover:bg-[var(--negative)]/20 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete permanently
      </button>

      {archiveOpen && (
        <ArchiveDialog
          strategyId={strategyId}
          strategyName={strategyName}
          onClose={() => setArchiveOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteDialog
          strategyId={strategyId}
          strategyName={strategyName}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}

function UnarchiveButton({ strategyId }: { strategyId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await unarchiveStrategy(strategyId)
        })
      }}
      className="inline-flex items-center gap-1.5 h-7 rounded border border-border bg-card px-2.5 text-xs text-foreground/80 hover:bg-muted/50 hover:text-foreground transition-colors disabled:opacity-50"
    >
      <ArchiveRestore className="h-3.5 w-3.5" />
      {pending ? 'Restoring…' : 'Unarchive'}
    </button>
  )
}

function ArchiveDialog({
  strategyId,
  strategyName,
  onClose,
}: {
  strategyId: string
  strategyName: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function confirm() {
    setError(null)
    startTransition(async () => {
      const res = await archiveStrategy(strategyId)
      if (!res.ok) setError('Could not archive strategy.')
      else onClose()
    })
  }

  return (
    <Modal onClose={pending ? () => {} : onClose}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Archive strategy?</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-mono text-foreground">{strategyName}</span> will be hidden
          from default views. Its backtests and trades stay intact, and you can
          restore it later from <span className="text-foreground">Show archived</span>.
        </p>
      </div>
      {error && <div className="text-[11px] text-[var(--negative)]">{error}</div>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="h-7 rounded border border-border bg-card px-3 text-xs hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="h-7 rounded border border-foreground/30 bg-foreground/10 px-3 text-xs text-foreground hover:bg-foreground/20 disabled:opacity-50 transition-colors"
        >
          {pending ? 'Archiving…' : 'Archive'}
        </button>
      </div>
    </Modal>
  )
}

function DeleteDialog({
  strategyId,
  strategyName,
  onClose,
}: {
  strategyId: string
  strategyName: string
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<
    | { state: 'loading' }
    | { state: 'ready'; backtests: number; trades: number }
    | { state: 'error' }
  >({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    getStrategyDeletePreview(strategyId).then((res) => {
      if (cancelled) return
      if (res.ok) setPreview({ state: 'ready', backtests: res.backtests ?? 0, trades: res.trades ?? 0 })
      else setPreview({ state: 'error' })
    })
    return () => {
      cancelled = true
    }
  }, [strategyId])

  const canDelete = typed.trim() === CONFIRM_TOKEN && !pending

  function confirm() {
    if (!canDelete) return
    setError(null)
    startTransition(async () => {
      // Server action redirects to /strategies on success;
      // we only see a return value on failure.
      const res = await deleteStrategy(strategyId)
      if (res && !res.ok) {
        setError(
          res.error === 'unauthorized' ? 'Not signed in.' :
          res.error === 'not_found'    ? 'Already deleted.' :
          'Could not delete strategy.',
        )
      }
    })
  }

  return (
    <Modal onClose={pending ? () => {} : onClose}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Delete strategy permanently?</h2>
        <PreviewLine
          preview={preview}
          render={(p) => (
            <p className="text-xs text-muted-foreground leading-relaxed">
              This will delete strategy{' '}
              <span className="font-mono text-foreground">{strategyName}</span>
              {' '}and{' '}
              <span className="text-[var(--warning)] font-mono tabular-nums">
                {p.backtests.toLocaleString()} backtest{p.backtests === 1 ? '' : 's'}
              </span>
              {' + '}
              <span className="text-[var(--warning)] font-mono tabular-nums">
                {p.trades.toLocaleString()} trade{p.trades === 1 ? '' : 's'}
              </span>
              . This cannot be undone.
            </p>
          )}
          strategyName={strategyName}
        />
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

      {error && <div className="text-[11px] text-[var(--negative)]">{error}</div>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="h-7 rounded border border-border bg-card px-3 text-xs hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!canDelete}
          className={cn(
            'h-7 rounded border px-3 text-xs transition-colors',
            canDelete
              ? 'border-[var(--negative)]/40 bg-[var(--negative)]/15 text-[var(--negative)] hover:bg-[var(--negative)]/25 cursor-pointer'
              : 'border-border bg-card text-muted-foreground/60 cursor-not-allowed',
          )}
        >
          {pending ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </Modal>
  )
}

function PreviewLine({
  preview,
  render,
  strategyName,
}: {
  preview:
    | { state: 'loading' }
    | { state: 'ready'; backtests: number; trades: number }
    | { state: 'error' }
  render: (p: { backtests: number; trades: number }) => React.ReactNode
  strategyName: string
}) {
  if (preview.state === 'loading') {
    return (
      <p className="text-xs text-muted-foreground leading-relaxed">
        Counting backtests and trades attached to{' '}
        <span className="font-mono text-foreground">{strategyName}</span>…
      </p>
    )
  }
  if (preview.state === 'error') {
    return (
      <p className="text-xs text-[var(--warning)] leading-relaxed">
        Could not preview the cascade. Deleting strategy{' '}
        <span className="font-mono text-foreground">{strategyName}</span> will still
        cascade to its backtests and trades.
      </p>
    )
  }
  return <>{render(preview)}</>
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded border border-border bg-popover p-5 space-y-4 shadow-xl"
      >
        {children}
      </div>
    </div>
  )
}

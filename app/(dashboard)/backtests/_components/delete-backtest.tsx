'use client'

import { useEffect, useState, useTransition } from 'react'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  archiveBacktest,
  deleteBacktest,
  getBacktestDeletePreview,
  unarchiveBacktest,
} from './actions'

// Icon-only variant used inline on the backtests list so Bryce can archive /
// delete a row without clicking into its detail page. Reuses the same dialog
// components as the full-width detail-page action panel.
export function BacktestInlineActions({
  backtestId,
  backtestLabel,
  archivedAt,
}: {
  backtestId: string
  backtestLabel: string
  archivedAt: string | null
}) {
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function unarchive(e: React.MouseEvent) {
    e.stopPropagation()
    startTransition(async () => {
      await unarchiveBacktest(backtestId)
    })
  }

  return (
    <div className="inline-flex items-center gap-1">
      {archivedAt ? (
        <IconButton
          label="Restore"
          onClick={unarchive}
          disabled={pending}
          tone="default"
        >
          <ArchiveRestore className="h-3.5 w-3.5" />
        </IconButton>
      ) : (
        <IconButton
          label="Archive"
          onClick={(e) => {
            e.stopPropagation()
            setArchiveOpen(true)
          }}
          tone="default"
        >
          <Archive className="h-3.5 w-3.5" />
        </IconButton>
      )}
      <IconButton
        label="Delete permanently"
        onClick={(e) => {
          e.stopPropagation()
          setDeleteOpen(true)
        }}
        tone="danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </IconButton>

      {archiveOpen && (
        <ArchiveDialog
          backtestId={backtestId}
          backtestLabel={backtestLabel}
          onClose={() => setArchiveOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteDialog
          backtestId={backtestId}
          backtestLabel={backtestLabel}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  tone,
  children,
}: {
  label: string
  onClick: (e: React.MouseEvent) => void
  disabled?: boolean
  tone: 'default' | 'danger'
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded border transition-colors',
        tone === 'danger'
          ? 'border-border bg-card text-muted-foreground hover:border-[var(--negative)]/40 hover:bg-[var(--negative)]/10 hover:text-[var(--negative)]'
          : 'border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {children}
    </button>
  )
}

export function BacktestRowActions({
  backtestId,
  backtestLabel,
  archivedAt,
}: {
  backtestId: string
  backtestLabel: string
  archivedAt: string | null
}) {
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {archivedAt ? (
        <UnarchiveButton backtestId={backtestId} />
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
          backtestId={backtestId}
          backtestLabel={backtestLabel}
          onClose={() => setArchiveOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteDialog
          backtestId={backtestId}
          backtestLabel={backtestLabel}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  )
}

function UnarchiveButton({ backtestId }: { backtestId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await unarchiveBacktest(backtestId)
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
  backtestId,
  backtestLabel,
  onClose,
}: {
  backtestId: string
  backtestLabel: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function confirm() {
    setError(null)
    startTransition(async () => {
      const res = await archiveBacktest(backtestId)
      if (!res.ok) setError('Could not archive backtest.')
      else onClose()
    })
  }

  return (
    <Modal onClose={pending ? () => {} : onClose}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Archive backtest?</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-mono text-foreground">{backtestLabel}</span> will be hidden
          from the default backtest list. Its trades and notes stay intact, and you can
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
  backtestId,
  backtestLabel,
  onClose,
}: {
  backtestId: string
  backtestLabel: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<
    | { state: 'loading' }
    | { state: 'ready'; trades: number }
    | { state: 'error' }
  >({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    getBacktestDeletePreview(backtestId).then((res) => {
      if (cancelled) return
      if (res.ok) setPreview({ state: 'ready', trades: res.trades ?? 0 })
      else setPreview({ state: 'error' })
    })
    return () => {
      cancelled = true
    }
  }, [backtestId])

  function confirm() {
    if (pending) return
    setError(null)
    startTransition(async () => {
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
    <Modal onClose={pending ? () => {} : onClose}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Delete backtest permanently?</h2>
        {preview.state === 'loading' ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            Counting trades attached to{' '}
            <span className="font-mono text-foreground">{backtestLabel}</span>…
          </p>
        ) : preview.state === 'error' ? (
          <p className="text-xs text-[var(--warning)] leading-relaxed">
            Could not preview trade count. Deleting{' '}
            <span className="font-mono text-foreground">{backtestLabel}</span> will still
            cascade to its trades and notes.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground leading-relaxed">
            This will delete backtest{' '}
            <span className="font-mono text-foreground">{backtestLabel}</span>
            {' '}and{' '}
            <span className="text-[var(--warning)] font-mono tabular-nums">
              {preview.trades.toLocaleString()} trade{preview.trades === 1 ? '' : 's'}
            </span>
            . This cannot be undone.
          </p>
        )}
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
          className={cn(
            'h-7 rounded border px-3 text-xs transition-colors',
            'border-[var(--negative)]/40 bg-[var(--negative)]/15 text-[var(--negative)] hover:bg-[var(--negative)]/25',
            pending && 'opacity-60 cursor-not-allowed',
          )}
        >
          {pending ? 'Deleting…' : 'Delete permanently'}
        </button>
      </div>
    </Modal>
  )
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

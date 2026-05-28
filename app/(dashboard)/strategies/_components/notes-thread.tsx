'use client'

import { useState, useTransition } from 'react'
import { addStrategyNote } from './actions'
import { relativeTime } from '../../backtests/_components/format'

export type Note = {
  id: string | number
  author: string | null
  body: string | null
  created_at: string | null
}

export function NotesThread({
  strategyId,
  notes,
}: {
  strategyId: string
  notes: Note[]
}) {
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const text = body.trim()
    if (!text) return
    startTransition(async () => {
      const res = await addStrategyNote(strategyId, text)
      if (!res.ok) {
        setError(
          res.error === 'unauthorized' ? 'Not signed in.' :
          res.error === 'empty' ? 'Note is empty.' :
          'Could not post note.',
        )
        return
      }
      setBody('')
    })
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        className="rounded border border-border bg-card p-3 space-y-2"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          disabled={pending}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          className="w-full resize-y rounded border border-border bg-background px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-ring disabled:opacity-50"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {error
              ? <span className="text-[var(--negative)]">{error}</span>
              : <>⌘/Ctrl+Enter to post</>}
          </span>
          <button
            type="submit"
            disabled={pending || !body.trim()}
            className="h-7 rounded border border-border bg-secondary px-3 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>

      <div className="rounded border border-border bg-card overflow-hidden">
        {notes.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            No notes yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {notes.map((n) => {
              const ts = n.created_at ? new Date(n.created_at) : null
              return (
                <li key={n.id} className="px-3 py-2.5 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-medium text-foreground">{n.author ?? 'unknown'}</span>
                    <span
                      className="text-[10px] text-muted-foreground font-mono"
                      title={n.created_at ?? undefined}
                    >
                      {ts ? relativeTime(ts) : ''}
                    </span>
                  </div>
                  <div className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                    {n.body}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

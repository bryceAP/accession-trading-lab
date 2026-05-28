// Event type label/colour map. Keys are exact event_type strings; anything not
// listed falls back to a derived label and a muted colour.
export const EVENT_TYPE_STYLES: Record<string, { label: string; cls: string }> = {
  trade_open:    { label: 'OPEN',   cls: 'text-[var(--chart-1)]'  },
  trade_close:   { label: 'CLOSE',  cls: 'text-[var(--chart-2)]'  },
  signal:        { label: 'SIG',    cls: 'text-[var(--warning)]'  },
  error:         { label: 'ERR',    cls: 'text-[var(--negative)]' },
  heartbeat:     { label: 'HB',     cls: 'text-muted-foreground'  },
  status_change: { label: 'STATUS', cls: 'text-[var(--chart-5)]'  },
  system_start:  { label: 'START',  cls: 'text-[var(--positive)]' },
  system_stop:   { label: 'STOP',   cls: 'text-muted-foreground'  },
  db_test:       { label: 'TEST',   cls: 'text-muted-foreground'  },
}

export function eventStyle(type: string) {
  return EVENT_TYPE_STYLES[type] ?? {
    label: type.replace(/_/g, ' ').slice(0, 8).toUpperCase(),
    cls: 'text-muted-foreground',
  }
}

// Source styling.
export const SOURCE_STYLES: Record<string, string> = {
  backtest: 'border-[var(--chart-1)]/30 text-[var(--chart-1)] bg-[var(--chart-1)]/10',
  paper:    'border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning)]/10',
  live:     'border-[var(--positive)]/30 text-[var(--positive)] bg-[var(--positive)]/10',
}

export function sourceStyle(source: string): string {
  return SOURCE_STYLES[source] ?? 'border-border text-muted-foreground bg-muted/40'
}

// One-line summary derived from the event's data jsonb.
export function eventSummary(type: string, data: Record<string, unknown> | null | undefined): string {
  if (!data) return '—'

  if (typeof data.message     === 'string') return data.message
  if (typeof data.description === 'string') return data.description
  if (typeof data.reason      === 'string') return data.reason

  if (type.startsWith('trade_')) {
    const parts: string[] = []
    const side = data.side as string | undefined
    const qty  = (data.qty ?? data.quantity) as number | undefined
    const inst = (data.instrument ?? data.symbol) as string | undefined
    const px   = (data.price ?? data.entry_price ?? data.exit_price) as number | undefined
    const pnl  = data.pnl as number | undefined
    if (side) parts.push(side.toLowerCase())
    if (qty)  parts.push(String(qty))
    if (inst) parts.push(inst)
    if (px)   parts.push(`@ ${Number(px).toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
    if (pnl != null) parts.push(`· P&L ${pnl >= 0 ? '+' : ''}$${Number(pnl).toFixed(2)}`)
    if (parts.length) return parts.join(' ')
  }

  if (type === 'heartbeat') return typeof data.status === 'string' ? data.status : 'ok'

  if (type === 'system_start' || type === 'system_stop') {
    const parts: string[] = []
    const strat = data.strategy as string | undefined
    const inst  = data.instrument as string | undefined
    const start = data.start as string | undefined
    const end   = data.end as string | undefined
    const tf    = data.timeframe as string | undefined
    if (strat) parts.push(strat)
    if (inst)  parts.push(inst)
    if (tf)    parts.push(tf)
    if (start && end) parts.push(`${start} → ${end}`)
    if (parts.length) return parts.join(' · ')
  }

  const entries = Object.entries(data).slice(0, 3)
  if (!entries.length) return '—'
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('  ·  ')
}

export function formatET(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const date = d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: '2-digit',
  })
  const time = d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return `${date} ${time}`
}

import { cn } from '@/lib/utils'

// Mirrors the runner's metrics.run_params jsonb sub-object. Every field is
// optional because old rows predate this object entirely and partial rows are
// possible if the runner is updated mid-batch. Read-only — the dashboard
// never writes this.
export type RunParams = {
  slippage_price?: number
  commission?: number
  leverage?: number
  fill_tf?: string
  ideal_fills?: boolean
  entry_mode?: string
  source_tz?: string
}

export const RUN_PARAMS_KEY = 'run_params'

export function parseRunParams(
  metrics: Record<string, unknown> | null | undefined,
): RunParams | null {
  if (!metrics) return null
  const raw = metrics[RUN_PARAMS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const out: RunParams = {}
  if (typeof o.slippage_price === 'number' && Number.isFinite(o.slippage_price)) out.slippage_price = o.slippage_price
  if (typeof o.commission === 'number' && Number.isFinite(o.commission)) out.commission = o.commission
  if (typeof o.leverage === 'number' && Number.isFinite(o.leverage)) out.leverage = o.leverage
  if (typeof o.fill_tf === 'string' && o.fill_tf) out.fill_tf = o.fill_tf
  if (typeof o.ideal_fills === 'boolean') out.ideal_fills = o.ideal_fills
  if (typeof o.entry_mode === 'string' && o.entry_mode) out.entry_mode = o.entry_mode
  if (typeof o.source_tz === 'string' && o.source_tz) out.source_tz = o.source_tz
  return Object.keys(out).length > 0 ? out : null
}

export type BadgeTone = 'default' | 'accent' | 'warn'

export type RunParamBadge = {
  key: string
  label: string
  title: string
  tone: BadgeTone
}

function trimNum(n: number): string {
  if (Number.isInteger(n)) return n.toString()
  // Pretty-print short floats without trailing zeros (e.g. 0.5, 0.025).
  return n.toFixed(4).replace(/\.?0+$/, '')
}

export function buildRunParamBadges(p: RunParams | null | undefined): RunParamBadge[] {
  if (!p) return []
  const out: RunParamBadge[] = []
  // Order matches the task spec: entry_mode → fill_tf → slippage → ideal_fills
  // first, then the rest.
  if (p.entry_mode) {
    out.push({
      key: 'entry_mode',
      label: p.entry_mode,
      title: `entry_mode: ${p.entry_mode}`,
      tone: 'accent',
    })
  }
  if (p.fill_tf) {
    out.push({
      key: 'fill_tf',
      label: `fill ${p.fill_tf}`,
      title: `fill_tf: ${p.fill_tf}`,
      tone: 'default',
    })
  }
  if (p.slippage_price != null) {
    out.push({
      key: 'slippage',
      label: `slip ${trimNum(p.slippage_price)}`,
      title: `slippage_price: ${p.slippage_price}`,
      tone: 'default',
    })
  }
  if (p.ideal_fills === true) {
    out.push({
      key: 'ideal',
      label: 'ideal',
      title: 'ideal_fills: true (optimistic fills)',
      tone: 'warn',
    })
  }
  if (p.commission != null) {
    out.push({
      key: 'commission',
      label: `comm ${trimNum(p.commission)}`,
      title: `commission: ${p.commission}`,
      tone: 'default',
    })
  }
  if (p.leverage != null && p.leverage !== 1) {
    out.push({
      key: 'leverage',
      label: `${trimNum(p.leverage)}x`,
      title: `leverage: ${p.leverage}`,
      tone: 'default',
    })
  }
  if (p.source_tz) {
    out.push({
      key: 'source_tz',
      label: p.source_tz,
      title: `source_tz: ${p.source_tz}`,
      tone: 'default',
    })
  }
  return out
}

const TONE_CLS: Record<BadgeTone, string> = {
  default: 'border-border bg-muted/40 text-foreground/80',
  accent: 'border-foreground/40 bg-foreground/10 text-foreground',
  warn: 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]',
}

export function RunParamBadge({ badge }: { badge: RunParamBadge }) {
  return (
    <span
      title={badge.title}
      className={cn(
        'inline-flex h-5 items-center rounded border px-1.5 font-mono text-[10px] lowercase tracking-wide',
        TONE_CLS[badge.tone],
      )}
    >
      {badge.label}
    </span>
  )
}

export function RunParamBadges({
  badges,
  className,
}: {
  badges: RunParamBadge[]
  className?: string
}) {
  if (badges.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {badges.map((b) => (
        <RunParamBadge key={b.key} badge={b} />
      ))}
    </div>
  )
}

import { cn } from '@/lib/utils'
import { strategyColor, strategyChipColors } from '@/lib/strategy-color'
import { strategyLabel, type StrategyNameInfo } from '@/lib/strategy-names'

// All strategy-identity rendering goes through these primitives so the dot
// color, fallback to programmatic name, and "show name as muted secondary"
// behaviour stay consistent across the app.

export function StrategyDot({
  name,
  className,
  size = 8,
}: {
  name: string | null | undefined
  className?: string
  size?: number
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-sm', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: strategyColor(name),
      }}
    />
  )
}

// One-line "dot + label" composed widget. `info` carries display_name +
// name. When the optional `secondary` slot is set, render the programmatic
// name underneath (or in a tooltip via `title`) so the source of truth is
// always recoverable. Falls back to the programmatic name when display_name
// is null — no UI breakage for unregistered rows.
export function StrategyLabel({
  info,
  fallback,
  className,
  dotSize = 8,
  showSecondary = false,
  truncate = true,
}: {
  info: StrategyNameInfo | null | undefined
  fallback?: string | null
  className?: string
  dotSize?: number
  showSecondary?: boolean
  truncate?: boolean
}) {
  const primary = strategyLabel(info, fallback)
  const programmatic = info?.name?.trim() ?? null
  // Only show the secondary line if display_name + name are distinct values.
  const secondary = showSecondary && programmatic && primary !== programmatic ? programmatic : null
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 min-w-0', className)}
      title={programmatic && programmatic !== primary ? programmatic : undefined}
    >
      <StrategyDot name={programmatic} size={dotSize} />
      <span className={cn('flex flex-col min-w-0', truncate && 'truncate')}>
        <span className={cn(truncate && 'truncate')}>{primary}</span>
        {secondary && (
          <span className="text-[10px] text-muted-foreground font-mono truncate">{secondary}</span>
        )}
      </span>
    </span>
  )
}

// Pill/chip variant for the activity log and other "tag-like" placements.
// Uses the chipColors palette which is WCAG-AA balanced.
export function StrategyChip({
  info,
  fallback,
  className,
}: {
  info: StrategyNameInfo | null | undefined
  fallback?: string | null
  className?: string
}) {
  const primary = strategyLabel(info, fallback)
  const programmatic = info?.name ?? fallback ?? primary
  const colors = strategyChipColors(programmatic)
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-[180px] items-center gap-1.5 rounded border px-1.5 font-mono text-[10px] truncate',
        className,
      )}
      style={{
        background: colors.bg,
        color: colors.fg,
        borderColor: colors.border,
      }}
      title={programmatic && programmatic !== primary ? programmatic : undefined}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-sm"
        style={{ background: colors.dot }}
      />
      <span className="truncate">{primary}</span>
    </span>
  )
}

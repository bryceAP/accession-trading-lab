import { cn } from '@/lib/utils'

// Structured run-shape badges rendered on every backtest list / card. Pulled
// from the immutable `backtests.config_snapshot` blob, with the user-set
// `label` text as a fallback for older rows the runner wrote before the
// snapshot column existed. Read-only — the dashboard never writes these.

export type ConfigSnapshot = {
  stop_hard_points?: number | string
  entry_mode?: string
  ny_session_only?: boolean
  fill_bar_type?: string
  [k: string]: unknown
}

export type BadgeTone = 'default' | 'accent'

export type ConfigBadge = {
  key: ConfigBadgeKey
  label: string
  title: string
  tone: BadgeTone
}

export type ConfigBadgeKey =
  | 'stop'
  | 'tf'
  | 'mode'
  | 'session'
  | 'span'
  | 'fill_tf'

// Fixed width per chip so a column of rows lines up. Each facet has its own
// width because the labels live in different ranges (stop ≈ "4pt", session ≈
// "23/5 Globex"). Widths were picked from the longest label each facet emits.
const CHIP_WIDTH_CLS: Record<ConfigBadgeKey, string> = {
  stop:    'w-[44px]',
  tf:      'w-[44px]',
  mode:    'w-[80px]',
  session: 'w-[92px]',
  span:    'w-[44px]',
  fill_tf: 'w-[60px]',
}

// 4pt + bar_close + Globex hours is the standard chassis (see project memory).
// Anything else is highlighted with the accent tone so it stands out at a
// glance when scanning the list.
const DEFAULT_STOP_PT = 4
const DEFAULT_ENTRY_MODE = 'bar_close'

export function parseConfigSnapshot(raw: unknown): ConfigSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as ConfigSnapshot
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v
  return null
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Match "_4pt_", "_3pt_", "_5pt_" inside a label like
// "band_tagging_no_round_stops_4pt_rsi_div" so older rows lacking
// config_snapshot still render a stop chip.
function stopPtFromLabel(label: string | null | undefined): number | null {
  if (!label) return null
  const m = label.match(/(?:^|[_\s\-])(\d+)\s*pt(?:$|[_\s\-])/i)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

// Look for known mode tokens inside a label. Conservative — only matches
// the two values the runner emits today so we don't invent badges.
function entryModeFromLabel(label: string | null | undefined): string | null {
  if (!label) return null
  const lc = label.toLowerCase()
  if (/(^|[_\s\-])band[_\s\-]?touch($|[_\s\-])/.test(lc)) return 'band_touch'
  if (/(^|[_\s\-])bar[_\s\-]?close($|[_\s\-])/.test(lc)) return 'bar_close'
  return null
}

// `ny_session_only=true` is rarely encoded in label text. Recognize the
// hand-typed convention "_NY_" / "_ny_hours_" if it shows up.
function nySessionFromLabel(label: string | null | undefined): boolean | null {
  if (!label) return null
  const lc = label.toLowerCase()
  if (/(^|[_\s\-])ny(_hours)?($|[_\s\-])/.test(lc)) return true
  return null
}

// Difference in calendar days → human bucket. Boundaries match the
// canonical run lengths Bryce uses (5wk / 1yr / 4yr / 10yr).
function formatSpan(start: string | null, end: string | null): string | null {
  if (!start || !end) return null
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null
  const days = Math.round((e - s) / 86_400_000)
  if (days < 14) return `${Math.max(1, Math.round(days / 7))}wk`
  if (days < 60) return `${Math.round(days / 7)}wk`
  // Above ~2 months we switch to year-rounding so 10yr / 4yr / 1yr come out clean.
  const years = days / 365
  if (years < 0.95) {
    return `${Math.max(1, Math.round(days / 30))}mo`
  }
  if (years < 1.5) return '1yr'
  return `${Math.round(years)}yr`
}

// Normalize a fill_bar_type like "BAR_1-MINUTE-LAST" or "1m" to a compact
// timeframe key. The runner has used several spellings over time; keep
// matches conservative so we don't fabricate values.
function normalizeFillTf(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.toString().trim()
  if (!s) return null
  // Already in dashboard timeframe form (1m, 15m, 1h, …)
  if (/^\d+[mhdwM]$/.test(s)) return s
  // BAR_1-MINUTE-LAST → 1m, BAR_15-MINUTE-LAST → 15m, BAR_1-HOUR-LAST → 1h
  const m = s.match(/(\d+)\s*[-_\s]?\s*(MINUTE|MIN|HOUR|HR|DAY|WEEK|MONTH)/i)
  if (m) {
    const n = m[1]
    switch (m[2].toUpperCase()) {
      case 'MINUTE':
      case 'MIN':   return `${n}m`
      case 'HOUR':
      case 'HR':    return `${n}h`
      case 'DAY':   return `${n}d`
      case 'WEEK':  return `${n}w`
      case 'MONTH': return `${n}M`
    }
  }
  return null
}

export type ConfigBadgeInput = {
  config_snapshot: unknown
  label: string | null
  timeframe: string | null
  start_date: string | null
  end_date: string | null
}

export function buildConfigBadges(input: ConfigBadgeInput): ConfigBadge[] {
  const snap = parseConfigSnapshot(input.config_snapshot)
  const out: ConfigBadge[] = []

  // ── stop ─────────────────────────────────────────────────────
  const stopRaw = snap ? asNumber(snap.stop_hard_points) : null
  const stop = stopRaw ?? stopPtFromLabel(input.label)
  if (stop != null) {
    const label = `${Math.round(stop)}pt`
    out.push({
      key: 'stop',
      label,
      title: `stop_hard_points: ${stop}`,
      tone: Math.round(stop) === DEFAULT_STOP_PT ? 'default' : 'accent',
    })
  }

  // ── tf ───────────────────────────────────────────────────────
  if (input.timeframe) {
    out.push({
      key: 'tf',
      label: input.timeframe,
      title: `timeframe: ${input.timeframe}`,
      // tf is a pure descriptor — neutral muted, never accented.
      tone: 'default',
    })
  }

  // ── mode ─────────────────────────────────────────────────────
  const mode = (snap ? asString(snap.entry_mode) : null) ?? entryModeFromLabel(input.label)
  if (mode) {
    out.push({
      key: 'mode',
      label: mode,
      title: `entry_mode: ${mode}`,
      tone: mode === DEFAULT_ENTRY_MODE ? 'default' : 'accent',
    })
  }

  // ── session ──────────────────────────────────────────────────
  let ny: boolean | null = null
  if (snap && typeof snap.ny_session_only === 'boolean') ny = snap.ny_session_only
  else ny = nySessionFromLabel(input.label)
  if (ny != null) {
    out.push({
      key: 'session',
      label: ny ? 'NY hours' : '23/5 Globex',
      title: `ny_session_only: ${ny}`,
      tone: ny ? 'accent' : 'default',
    })
  } else {
    // No way to tell — assume the default Globex session rather than
    // hiding the chip entirely. Keeps the column width steady across rows.
    out.push({
      key: 'session',
      label: '23/5 Globex',
      title: 'ny_session_only: unknown (assumed Globex)',
      tone: 'default',
    })
  }

  // ── span ─────────────────────────────────────────────────────
  const span = formatSpan(input.start_date, input.end_date)
  if (span) {
    out.push({
      key: 'span',
      label: span,
      title: `span: ${input.start_date} → ${input.end_date}`,
      tone: 'default',
    })
  }

  // ── fill-tf ──────────────────────────────────────────────────
  const fillRaw = snap ? asString(snap.fill_bar_type) : null
  const fill = normalizeFillTf(fillRaw)
  if (fill && fill !== input.timeframe) {
    out.push({
      key: 'fill_tf',
      label: `fill ${fill}`,
      title: `fill_bar_type: ${fillRaw}`,
      tone: 'accent',
    })
  }

  return out
}

const TONE_CLS: Record<BadgeTone, string> = {
  default: 'border-border bg-muted/40 text-muted-foreground',
  accent: 'border-foreground/40 bg-foreground/10 text-foreground',
}

export function ConfigBadgeChip({ badge }: { badge: ConfigBadge }) {
  return (
    <span
      title={badge.title}
      className={cn(
        'inline-flex h-5 items-center justify-center rounded border px-1.5 font-mono text-[10px] tracking-wide whitespace-nowrap',
        CHIP_WIDTH_CLS[badge.key],
        TONE_CLS[badge.tone],
      )}
    >
      {badge.label}
    </span>
  )
}

export function ConfigBadges({
  badges,
  className,
}: {
  badges: ConfigBadge[]
  className?: string
}) {
  if (badges.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {badges.map((b) => (
        <ConfigBadgeChip key={b.key} badge={b} />
      ))}
    </div>
  )
}

// Pull the session value as a derived filter facet. Returns 'ny' | 'globex'
// for the purposes of the backtests list filter (item #4) — 'globex' covers
// both explicit false and the unknown case, matching the chip behavior.
export function sessionFacet(input: ConfigBadgeInput): 'ny' | 'globex' {
  const snap = parseConfigSnapshot(input.config_snapshot)
  if (snap && typeof snap.ny_session_only === 'boolean') {
    return snap.ny_session_only ? 'ny' : 'globex'
  }
  return nySessionFromLabel(input.label) ? 'ny' : 'globex'
}

export function entryModeFacet(input: ConfigBadgeInput): string | null {
  const snap = parseConfigSnapshot(input.config_snapshot)
  const m = (snap ? asString(snap.entry_mode) : null) ?? entryModeFromLabel(input.label)
  return m
}

// Bucketed span keys for the filter dropdown — same buckets the chip emits.
export type SpanBucket = '5wk' | '1yr' | '4yr' | '10yr' | 'other'
export function spanBucket(start: string | null, end: string | null): SpanBucket | null {
  const label = formatSpan(start, end)
  if (!label) return null
  if (label === '1yr') return '1yr'
  if (label === '4yr') return '4yr'
  if (label === '10yr') return '10yr'
  if (label.endsWith('wk')) return '5wk'
  return 'other'
}

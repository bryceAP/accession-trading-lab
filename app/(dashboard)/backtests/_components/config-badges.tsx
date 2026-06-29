import { cn } from '@/lib/utils'

// Structured run-shape badges rendered on every backtest list / card. Pulled
// from the immutable `backtests.config_snapshot` blob, with the user-set
// `label` text as a fallback for older rows the runner wrote before the
// snapshot column existed. Read-only — the dashboard never writes these.

export type ConfigSnapshot = {
  stop_hard_points?: number | string
  entry_mode?: string
  ny_session_only?: boolean
  // Forward-compatible: runners can opt in by setting either flag explicitly,
  // or by writing `session_mode: 'ny_london'` instead of the boolean pair.
  ny_london_session?: boolean
  // After the 2026-06-29 mes-algo fix, skip_asia_session=true means force-flat
  // at 16:58 ET — i.e. NY + London + a sub-hour tail, not the old 19:00 ET
  // behavior that left positions exposed past overnight margin.
  skip_asia_session?: boolean
  session_mode?: string
  fill_bar_type?: string
  [k: string]: unknown
}

export type SessionKind = 'ny' | 'globex' | 'ny_london'

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
  session: 'w-[104px]',
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

// Detect the NY + London overlap session — used when the runner filters to
// the combined Europe/US window instead of either standalone session.
// Matches label conventions: _ny_lon_, _ny_london_, _nylondon_, _ny+lon_.
function nyLondonFromLabel(label: string | null | undefined): boolean | null {
  if (!label) return null
  const lc = label.toLowerCase()
  if (/(^|[_\s\-+])ny[_\s\-+]?lon(don)?($|[_\s\-+])/.test(lc)) return true
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
  const sessionKind = sessionFacet(input)
  if (sessionKind === 'ny_london') {
    // skip_asia_session is the more informative signal — surface the exact
    // force-flat time when that's what triggered the NY+London classification.
    const skipAsia = snap?.skip_asia_session === true
    out.push({
      key: 'session',
      label: 'NY + London',
      title: skipAsia
        ? 'session: skip_asia_session (NY+London, 16:58 ET force-flat)'
        : 'session_mode: ny_london',
      tone: 'accent',
    })
  } else if (sessionKind === 'ny') {
    out.push({
      key: 'session',
      label: 'NY hours',
      title: 'ny_session_only: true',
      tone: 'accent',
    })
  } else {
    // Globex 23/5 — either explicitly false, or unknown (default assumption).
    const explicit = snap && typeof snap.ny_session_only === 'boolean'
    out.push({
      key: 'session',
      label: '23/5 Globex',
      title: explicit ? 'ny_session_only: false' : 'ny_session_only: unknown (assumed Globex)',
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
// | 'ny_london' — 'globex' is the catch-all when nothing else is signalled.
export function sessionFacet(input: ConfigBadgeInput): SessionKind {
  const snap = parseConfigSnapshot(input.config_snapshot)
  // NY+London wins if explicitly signalled; otherwise NY-only; otherwise Globex.
  if (snap) {
    if (snap.ny_london_session === true) return 'ny_london'
    if (typeof snap.session_mode === 'string' && /ny[_\s\-+]?lon/i.test(snap.session_mode)) {
      return 'ny_london'
    }
    if (snap.skip_asia_session === true) return 'ny_london'
    if (typeof snap.ny_session_only === 'boolean') {
      return snap.ny_session_only ? 'ny' : 'globex'
    }
  }
  if (nyLondonFromLabel(input.label)) return 'ny_london'
  return nySessionFromLabel(input.label) ? 'ny' : 'globex'
}

export function entryModeFacet(input: ConfigBadgeInput): string | null {
  const snap = parseConfigSnapshot(input.config_snapshot)
  const m = (snap ? asString(snap.entry_mode) : null) ?? entryModeFromLabel(input.label)
  return m
}

// Bucketed span keys for the filter dropdown — the bucket is just the same
// human-readable label the chip displays (e.g. "5wk", "10mo", "1yr", "18yr"),
// so the filter options always match what's actually in the data.
export type SpanBucket = string
export function spanBucket(start: string | null, end: string | null): SpanBucket | null {
  return formatSpan(start, end)
}

// Sort key for span labels so the dropdown lists shortest → longest.
// Returns approximate day count; -1 for unparseable labels.
export function spanSortKey(label: string): number {
  const wk = label.match(/^(\d+)wk$/)
  if (wk) return parseInt(wk[1], 10) * 7
  const mo = label.match(/^(\d+)mo$/)
  if (mo) return parseInt(mo[1], 10) * 30
  const yr = label.match(/^(\d+)yr$/)
  if (yr) return parseInt(yr[1], 10) * 365
  return -1
}

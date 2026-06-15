export function relativeTime(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 0) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`
  if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))}mo ago`
  return `${Math.floor(s / (365 * 86400))}y ago`
}

export function fmtUsd(v: number | null | undefined, { signed = false } = {}): string {
  if (v == null || Number.isNaN(v)) return '—'
  const abs = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (signed) return `${v >= 0 ? '+' : '−'}$${abs}`
  return v < 0 ? `−$${abs}` : `$${abs}`
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—'
  const pct = Math.abs(v) <= 1 ? v * 100 : v
  return `${pct.toFixed(digits)}%`
}

export function fmtNumber(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return Math.round(v).toLocaleString('en-US')
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function fmtDateTimeWithSeconds(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  return `${date} · ${time}`
}

export function fmtElapsed(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) {
    const totalSec = Math.floor(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${m}m ${s}s`
  }
  const totalMin = Math.floor(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m}m`
}

export const TIMEFRAME_OPTIONS = [
  { value: '1m',   label: '1 min' },
  { value: '3m',   label: '3 min' },
  { value: '5m',   label: '5 min' },
  { value: '15m',  label: '15 min' },
  { value: '30m',  label: '30 min' },
  { value: '1h',   label: '1 hr' },
  { value: '81m',  label: '81 min' },
  { value: '135m', label: '135' },
  { value: '1d',   label: 'D' },
  { value: '1w',   label: 'W' },
  { value: '1M',   label: 'M' },
] as const

export type TimeframeValue = (typeof TIMEFRAME_OPTIONS)[number]['value']

const TIMEFRAME_LABEL_MAP: Record<string, string> = Object.fromEntries(
  TIMEFRAME_OPTIONS.map((o) => [o.value, o.label]),
)

export function timeframeLabel(value: string | null | undefined): string {
  if (!value) return '—'
  return TIMEFRAME_LABEL_MAP[value] ?? value
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`
  const d = Math.floor(h / 24)
  const remH = h % 24
  return remH ? `${d}d ${remH}h` : `${d}d`
}

export function pnlClass(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return 'text-muted-foreground'
  if (n > 0) return 'text-[var(--positive)]'
  if (n < 0) return 'text-[var(--negative)]'
  return 'text-muted-foreground'
}

// Candidate keys per logical metric. Nautilus PortfolioAnalyzer keys
// (literal strings with spaces, parens, and casing) listed alongside
// snake_case fallbacks so older or alternate writers still resolve.
const METRIC_KEYS = {
  total_pnl: [
    'PnL (total)',
    'total_pnl', 'net_pnl', 'pnl', 'profit',
  ],
  win_rate: [
    'Win Rate',
    'win_rate', 'winrate', 'win_pct',
  ],
  sharpe: [
    'Sharpe Ratio (252 days)',
    'Sharpe Ratio',
    'sharpe', 'sharpe_ratio',
  ],
  max_drawdown: [
    'max_drawdown', 'max_dd', 'mdd',
  ],
  total_trades: [
    'Total Positions', 'Positions', 'Position Count',
    'Total Orders', 'Orders', 'Order Count',
    'total_positions', 'total_orders',
    'position_count', 'order_count',
    'total_trades', 'num_trades', 'trade_count', 'trades',
  ],
  profit_factor: [
    'Profit Factor',
    'profit_factor', 'pf',
  ],
} as const

export function pickMetric(
  metrics: Record<string, unknown> | null | undefined,
  kind: keyof typeof METRIC_KEYS,
): number | null {
  if (!metrics) return null
  const candidates = METRIC_KEYS[kind]

  // 1. Exact-key match (preserves candidate order priority).
  for (const k of candidates) {
    if (k in metrics) {
      const n = asNumber(metrics[k])
      if (n != null) return n
    }
  }

  // 2. Case-insensitive fallback. Nautilus / Python writers occasionally
  // shift casing across versions; a CI sweep keeps the lookup working.
  const lc = new Map<string, unknown>()
  for (const [k, v] of Object.entries(metrics)) lc.set(k.toLowerCase(), v)
  for (const k of candidates) {
    if (k in metrics) continue // already tried exact
    const v = lc.get(k.toLowerCase())
    if (v !== undefined) {
      const n = asNumber(v)
      if (n != null) return n
    }
  }

  return null
}

// Walk an equity_curve jsonb and return the worst peak-to-trough drop
// as a positive USD magnitude. Returns null when the curve has no
// usable equity values. Same algorithm as the detail page's drawdown
// chart (running peak minus current equity, take the max).
export function maxDrawdownFromCurve(raw: unknown): number | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  let peak = -Infinity
  let maxDd = 0
  let seen = 0
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const obj = p as Record<string, unknown>
    const equity = asNumber(obj.equity ?? obj.value ?? obj.v ?? obj.balance)
    if (equity == null) continue
    seen++
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDd) maxDd = dd
  }
  return seen > 0 ? maxDd : null
}

const METRIC_LABELS: Record<string, string> = {
  total_pnl: 'Total P&L',
  net_pnl: 'Net P&L',
  pnl: 'P&L',
  profit: 'Profit',
  win_rate: 'Win rate',
  winrate: 'Win rate',
  win_pct: 'Win rate',
  sharpe: 'Sharpe',
  sharpe_ratio: 'Sharpe ratio',
  sortino: 'Sortino',
  sortino_ratio: 'Sortino ratio',
  max_drawdown: 'Max drawdown',
  max_dd: 'Max drawdown',
  mdd: 'Max drawdown',
  total_trades: 'Total trades',
  num_trades: 'Total trades',
  trade_count: 'Total trades',
  avg_trade: 'Avg trade',
  avg_win: 'Avg win',
  avg_loss: 'Avg loss',
  profit_factor: 'Profit factor',
  expectancy: 'Expectancy',
  cagr: 'CAGR',
  volatility: 'Volatility',
  exposure: 'Exposure',
  beta: 'Beta',
  alpha: 'Alpha',
}

export function metricLabel(key: string): string {
  if (METRIC_LABELS[key]) return METRIC_LABELS[key]
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export type MetricKind = 'pct' | 'usd' | 'ratio' | 'int' | 'num'

export function metricKind(key: string): MetricKind {
  const k = key.toLowerCase()
  // Order matters: 'ratio' must beat 'rate' (substring), and explicit '%' wins
  // over 'pnl' for keys like "PnL% (total)".
  if (k.includes('ratio') || k.includes('factor')) return 'ratio'
  if (k.includes('orders') || k.includes('positions')) return 'int'
  if (k.includes('rate') || k.includes('return') || k.includes('%')) return 'pct'
  if (k.includes('pnl') || k.includes('winner') || k.includes('loser') || k.includes('expectancy')) return 'usd'
  return 'num'
}

export function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isNaN(v) ? null : v
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isNaN(n) ? null : n
  }
  return null
}

export function formatMetricValue(key: string, v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'

  const n = asNumber(v)
  if (n == null) return typeof v === 'string' ? v : String(v)

  switch (metricKind(key)) {
    case 'pct': {
      // Rates/returns from Nautilus arrive as proportions (0–1); scale them.
      // Use 2 decimals for sub-1% values so 0.09% doesn't collapse to 0.1%.
      const pct = Math.abs(n) <= 1 ? n * 100 : n
      const digits = Math.abs(pct) < 1 && pct !== 0 ? 2 : 1
      return `${pct.toFixed(digits)}%`
    }
    case 'usd':
      return fmtUsd(n)
    case 'ratio':
      return fmtNumber(n, 2)
    case 'int':
      return fmtInt(n)
    case 'num':
      return fmtNumber(n, 2)
  }
}

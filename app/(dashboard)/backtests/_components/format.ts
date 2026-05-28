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

const METRIC_KEYS = {
  total_pnl: ['total_pnl', 'net_pnl', 'pnl', 'profit'],
  win_rate: ['win_rate', 'winrate', 'win_pct'],
  sharpe: ['sharpe', 'sharpe_ratio'],
  max_drawdown: ['max_drawdown', 'max_dd', 'mdd'],
  total_trades: ['total_trades', 'num_trades', 'trade_count', 'trades'],
} as const

export function pickMetric(
  metrics: Record<string, unknown> | null | undefined,
  kind: keyof typeof METRIC_KEYS,
): number | null {
  if (!metrics) return null
  for (const k of METRIC_KEYS[kind]) {
    const v = metrics[k]
    if (typeof v === 'number' && !Number.isNaN(v)) return v
  }
  return null
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

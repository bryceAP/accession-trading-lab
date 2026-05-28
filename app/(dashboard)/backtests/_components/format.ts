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

export function formatMetricValue(key: string, v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v !== 'number' || Number.isNaN(v)) return String(v)

  const k = key.toLowerCase()
  if (k.includes('pnl') || k.includes('profit') || k === 'avg_trade' || k === 'avg_win' || k === 'avg_loss' || k === 'expectancy') {
    return fmtUsd(v, { signed: true })
  }
  if (k.includes('rate') || k.includes('pct') || k.includes('drawdown') || k === 'cagr' || k === 'volatility' || k === 'exposure') {
    return fmtPct(v)
  }
  if (k.includes('trades') || k.includes('count')) {
    return fmtInt(v)
  }
  return fmtNumber(v, 2)
}

// Deterministic color assignment for strategy identity. The dashboard pairs
// every place we render a strategy name with a small colored dot (and the
// compare chart uses the same hue for its equity-curve lines), so Bryce can
// recognize a strategy at a glance without reading the label.
//
// The hue is derived from a tiny non-cryptographic hash of the strategy's
// programmatic `name` — sha1 would have been fine too, but FNV-1a works in
// both the server and the browser without pulling in node:crypto. The result
// is stable across page loads and across users.

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1a(s: string): number {
  let h = FNV_OFFSET
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // Math.imul keeps the multiplication in 32-bit range, the way the FNV
    // spec expects. Without it large strings would lose entropy as the
    // intermediate float drifts past 2^53.
    h = Math.imul(h, FNV_PRIME)
  }
  // Mix the top bits into the low bits so two strings differing only in
  // the last char don't end up neighbors mod 360.
  h ^= h >>> 16
  return h >>> 0
}

export function strategyHue(name: string | null | undefined): number {
  if (!name) return 0
  return fnv1a(name) % 360
}

export type ColorOpts = {
  lightness?: number
  sat?: number
}

export function strategyColor(name: string | null | undefined, opts: ColorOpts = {}): string {
  const { lightness = 55, sat = 65 } = opts
  return `hsl(${strategyHue(name)} ${sat}% ${lightness}%)`
}

// Background / foreground pair sized for chips and tinted backgrounds. The
// 92/30 lightness split keeps WCAG AA contrast even on the worst-luck hues
// (yellows ~60° sit at the harshest contrast trough). The dark theme bumps
// the foreground brighter so muted backgrounds still read well.
export type StrategyChipColors = {
  bg: string
  fg: string
  dot: string
  border: string
}

export function strategyChipColors(name: string | null | undefined): StrategyChipColors {
  const hue = strategyHue(name)
  return {
    bg: `hsl(${hue} 50% 92%)`,
    fg: `hsl(${hue} 70% 30%)`,
    dot: `hsl(${hue} 65% 55%)`,
    border: `hsl(${hue} 40% 75%)`,
  }
}

import { cn } from '@/lib/utils'

// Canonical order matches the runner's [exit-reason BREAKDOWN] log so the
// dashboard and the terminal output read identically. Any reason the runner
// emits that's missing here would still render — under "unknowns" sorted
// alphabetically — but with the raw key as label and neutral coloring.
//
// Tag families used by the active strategies (see strategies/*.py
// `self._exit_reasons[…] = …` calls):
//   target / target_mid / target_far   → wins (positive coloring)
//   breakeven / breakeven_stop / breakeven_vwma → flat-ish exits (neutral)
//   structural_stop                    → structural exit (neutral)
//   hard_stop                          → loss (negative)
//   force_flat                         → EOD flatten (neutral)
//   other                              → runner couldn't attribute (neutral, but
//                                        flagged in the breakdown section)
export const EXIT_REASON_ORDER = [
  'target',
  'target_mid',
  'target_far',
  'hard_stop',
  'breakeven',
  'breakeven_stop',
  'breakeven_vwma',
  'structural_stop',
  'force_flat',
  'other',
] as const

export const EXIT_REASON_LABEL: Record<string, string> = {
  target: 'Target',
  target_mid: 'Target (mid)',
  target_far: 'Target (far)',
  hard_stop: 'Hard stop',
  breakeven: 'Breakeven',
  breakeven_stop: 'Breakeven stop',
  breakeven_vwma: 'Breakeven (VWMA)',
  structural_stop: 'Structural stop',
  force_flat: 'Force flat',
  other: 'Other',
}

export type ExitReasonKind = 'positive' | 'negative' | 'neutral'

// Prefix-based so new variants stay correctly colored without a code change:
// any tag starting with `target` is a win, `hard_stop` is a loss, anything
// else (breakeven/structural/force_flat/other/unknown) renders neutral.
export function exitReasonKind(reason: string | null | undefined): ExitReasonKind {
  if (!reason) return 'neutral'
  if (reason === 'hard_stop') return 'negative'
  if (reason.startsWith('target')) return 'positive'
  return 'neutral'
}

export function exitReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '—'
  return EXIT_REASON_LABEL[reason] ?? reason
}

export function ExitReasonBadge({ reason }: { reason: string | null | undefined }) {
  if (!reason) {
    return <span className="text-muted-foreground font-mono text-[11px]">—</span>
  }
  const kind = exitReasonKind(reason)
  const cls =
    kind === 'positive'
      ? 'border-[var(--positive)]/30 text-[var(--positive)] bg-[var(--positive)]/10'
      : kind === 'negative'
        ? 'border-[var(--negative)]/30 text-[var(--negative)] bg-[var(--negative)]/10'
        : 'border-border text-muted-foreground bg-muted/30'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase whitespace-nowrap',
        cls,
      )}
    >
      {exitReasonLabel(reason)}
    </span>
  )
}

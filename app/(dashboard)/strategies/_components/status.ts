export const STATUS_OPTIONS = ['draft', 'backtested', 'paper', 'live', 'archived'] as const

export type Status = (typeof STATUS_OPTIONS)[number]

export function isStatus(s: unknown): s is Status {
  return typeof s === 'string' && (STATUS_OPTIONS as readonly string[]).includes(s)
}

export const STATUS_STYLES: Record<Status, { label: string; cls: string; dotCls: string }> = {
  draft: {
    label: 'Draft',
    cls: 'border-border text-muted-foreground bg-muted/40',
    dotCls: 'bg-muted-foreground/50',
  },
  backtested: {
    label: 'Backtested',
    cls: 'border-[var(--chart-1)]/30 text-[var(--chart-1)] bg-[var(--chart-1)]/10',
    dotCls: 'bg-[var(--chart-1)]',
  },
  paper: {
    label: 'Paper',
    cls: 'border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning)]/10',
    dotCls: 'bg-[var(--warning)]',
  },
  live: {
    label: 'Live',
    cls: 'border-[var(--positive)]/30 text-[var(--positive)] bg-[var(--positive)]/10',
    dotCls: 'bg-[var(--positive)]',
  },
  archived: {
    label: 'Archived',
    cls: 'border-border text-muted-foreground/70 bg-muted/30',
    dotCls: 'bg-muted-foreground/30',
  },
}

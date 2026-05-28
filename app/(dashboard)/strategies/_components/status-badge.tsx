import { cn } from '@/lib/utils'
import { STATUS_STYLES, isStatus } from './status'

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const s = isStatus(status) ? status : null
  const style = s
    ? STATUS_STYLES[s]
    : { label: status ?? 'Unknown', cls: 'border-border text-muted-foreground bg-muted/40', dotCls: 'bg-muted-foreground/30' }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase',
        style.cls,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dotCls)} />
      {style.label}
    </span>
  )
}

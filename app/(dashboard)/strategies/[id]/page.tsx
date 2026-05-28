import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

export default async function StrategyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const { data: strategy, error } = await supabase
    .from('strategies')
    .select('*')
    .eq('id', params.id)
    .single()

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/strategies" className="text-xs text-muted-foreground hover:text-foreground">
          ← Strategies
        </Link>
        {error ? (
          <Badge variant="destructive" className="text-xs">Not found</Badge>
        ) : null}
      </div>

      <h1 className="text-sm font-semibold tracking-tight">
        {strategy?.name ?? params.id}
      </h1>

      {strategy && (
        <div className="rounded border border-border bg-card p-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
            <Row label="Version"    value={strategy.version} />
            <Row label="Instrument" value={strategy.instrument} />
            <Row label="Status"     value={strategy.status} />
            <Row label="Author"     value={strategy.author} />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Strategy detail view coming soon.
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </>
  )
}

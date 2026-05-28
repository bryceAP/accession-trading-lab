'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function addBacktestNote(backtestId: string, body: string) {
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: 'empty' as const }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const author = user.email ?? user.id
  const { error } = await supabase.from('notes').insert({
    target_type: 'backtest',
    target_id: backtestId,
    body: trimmed,
    author,
  })

  if (error) {
    console.error('[addBacktestNote]', error)
    return { ok: false, error: 'insert_failed' as const }
  }

  revalidatePath(`/backtests/${backtestId}`)
  return { ok: true as const }
}

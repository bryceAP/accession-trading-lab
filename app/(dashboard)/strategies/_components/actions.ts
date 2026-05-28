'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isStatus } from './status'

export async function updateStrategyStatus(strategyId: string, status: string) {
  if (!isStatus(status)) return { ok: false, error: 'invalid_status' as const }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const { error } = await supabase
    .from('strategies')
    .update({ status })
    .eq('id', strategyId)

  if (error) {
    console.error('[updateStrategyStatus]', error)
    return { ok: false, error: 'update_failed' as const }
  }

  revalidatePath('/strategies')
  revalidatePath(`/strategies/${strategyId}`)
  return { ok: true as const }
}

export async function deleteStrategy(strategyId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const { error } = await supabase
    .from('strategies')
    .delete()
    .eq('id', strategyId)

  if (error) {
    console.error('[deleteStrategy]', error)
    return { ok: false, error: 'delete_failed' as const }
  }

  revalidatePath('/strategies')
  redirect('/strategies')
}

export async function addStrategyNote(strategyId: string, body: string) {
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: 'empty' as const }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const author = user.email ?? user.id
  const { error } = await supabase.from('notes').insert({
    target_type: 'strategy',
    target_id: strategyId,
    body: trimmed,
    author,
  })

  if (error) {
    console.error('[addStrategyNote]', error)
    return { ok: false, error: 'insert_failed' as const }
  }

  revalidatePath(`/strategies/${strategyId}`)
  return { ok: true as const }
}

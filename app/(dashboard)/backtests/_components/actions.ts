'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function deleteBacktest(backtestId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  // No FK cascade assumed — clear child rows first, then the backtest.
  // If trades/notes delete fails we bail so we don't leave a phantom
  // backtest row with detached children.
  const tradesRes = await supabase
    .from('trades')
    .delete()
    .eq('backtest_id', backtestId)
  if (tradesRes.error) {
    console.error('[deleteBacktest trades]', backtestId, tradesRes.error)
    return { ok: false, error: 'delete_trades_failed' as const }
  }

  const notesRes = await supabase
    .from('notes')
    .delete()
    .eq('target_type', 'backtest')
    .eq('target_id', backtestId)
  if (notesRes.error) {
    console.error('[deleteBacktest notes]', backtestId, notesRes.error)
    return { ok: false, error: 'delete_notes_failed' as const }
  }

  const { error } = await supabase
    .from('backtests')
    .delete()
    .eq('id', backtestId)
  if (error) {
    console.error('[deleteBacktest]', backtestId, error)
    return { ok: false, error: 'delete_failed' as const }
  }

  revalidatePath('/backtests')
  revalidatePath('/strategies')
  redirect('/backtests')
}

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

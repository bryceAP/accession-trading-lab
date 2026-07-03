'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// Paper-trade lifecycle actions. Mirror the shape of the backtests actions
// so the frontend gets the same error tags and the same soft/hard split.
//
// Every action is guarded with .eq('source', 'paper') as belt-and-braces:
// a mistake in the caller can't nuke backtest trade rows. Also asserts
// auth — no anonymous archives.

export async function archivePaperTrade(tradeId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const { error } = await supabase
    .from('trades')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', tradeId)
    .eq('source', 'paper')

  if (error) {
    console.error('[archivePaperTrade]', error)
    // Surface the specific message so a missing column ("column
    // archived_at does not exist") reaches the UI unedited — makes it
    // obvious the backend still needs to add the column.
    return { ok: false, error: 'update_failed' as const, message: error.message }
  }

  revalidatePath('/')
  revalidatePath('/live')
  return { ok: true as const }
}

export async function unarchivePaperTrade(tradeId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const { error } = await supabase
    .from('trades')
    .update({ archived_at: null })
    .eq('id', tradeId)
    .eq('source', 'paper')

  if (error) {
    console.error('[unarchivePaperTrade]', error)
    return { ok: false, error: 'update_failed' as const, message: error.message }
  }

  revalidatePath('/')
  revalidatePath('/live')
  return { ok: true as const }
}

export async function deletePaperTrade(tradeId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  // Hard delete. Trades hold real account history — every caller path to
  // this action is expected to have already presented a confirm dialog.
  const { error } = await supabase
    .from('trades')
    .delete()
    .eq('id', tradeId)
    .eq('source', 'paper')

  if (error) {
    console.error('[deletePaperTrade]', error)
    return { ok: false, error: 'delete_failed' as const, message: error.message }
  }

  revalidatePath('/')
  revalidatePath('/live')
  return { ok: true as const }
}

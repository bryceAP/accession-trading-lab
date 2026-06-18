'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isStatus } from './status'

const DISPLAY_NAME_MAX = 80

// Free-text rename of a strategy's display label. Empty string clears the
// override and falls the UI back to the programmatic `name`. The hard cap
// matches the client-side validation in display-name-editor.tsx; bigger
// values are server-rejected so URL-poking can't sneak past.
export async function updateStrategyDisplayName(strategyId: string, displayName: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const trimmed = displayName.trim()
  if (trimmed.length > DISPLAY_NAME_MAX) {
    return { ok: false, error: 'too_long' as const }
  }

  const { error } = await supabase
    .from('strategies')
    .update({ display_name: trimmed.length === 0 ? null : trimmed })
    .eq('id', strategyId)

  if (error) {
    console.error('[updateStrategyDisplayName]', error)
    return { ok: false, error: 'update_failed' as const }
  }

  revalidatePath('/strategies')
  revalidatePath(`/strategies/${strategyId}`)
  revalidatePath('/backtests')
  return { ok: true as const }
}

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

// Soft-delete: sets archived_at = now() so the row is hidden from default
// list queries but still recoverable via the "Show archived" toggle. Distinct
// from the existing status='archived' lifecycle stage, which is a manual
// signal Bryce sets when a strategy stops being interesting.
export async function archiveStrategy(strategyId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const { error } = await supabase
    .from('strategies')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', strategyId)

  if (error) {
    console.error('[archiveStrategy]', error)
    return { ok: false, error: 'update_failed' as const }
  }

  revalidatePath('/strategies')
  revalidatePath(`/strategies/${strategyId}`)
  return { ok: true as const }
}

export async function unarchiveStrategy(strategyId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const { error } = await supabase
    .from('strategies')
    .update({ archived_at: null })
    .eq('id', strategyId)

  if (error) {
    console.error('[unarchiveStrategy]', error)
    return { ok: false, error: 'update_failed' as const }
  }

  revalidatePath('/strategies')
  revalidatePath(`/strategies/${strategyId}`)
  return { ok: true as const }
}

// Preview counts shown in the permanent-delete dialog. The deletion itself
// cascades through backtests → trades, so the preview should reflect what
// actually disappears. Match strategy_id OR strategy_name (mirrors how the
// strategy detail page joins backtests).
export async function getStrategyDeletePreview(strategyId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  const stratRes = await supabase
    .from('strategies')
    .select('id, name')
    .eq('id', strategyId)
    .maybeSingle()
  if (stratRes.error || !stratRes.data) {
    return { ok: false, error: 'not_found' as const }
  }
  const name = stratRes.data.name

  let backtestQuery = supabase
    .from('backtests')
    .select('id')
  if (name) backtestQuery = backtestQuery.or(`strategy_id.eq.${strategyId},strategy_name.eq.${name}`)
  else backtestQuery = backtestQuery.eq('strategy_id', strategyId)

  const btRes = await backtestQuery
  if (btRes.error) {
    console.error('[getStrategyDeletePreview backtests]', btRes.error)
    return { ok: false, error: 'preview_failed' as const }
  }
  const backtestIds = (btRes.data ?? []).map((b) => b.id)

  let trades = 0
  if (backtestIds.length > 0) {
    const tradeRes = await supabase
      .from('trades')
      .select('id', { count: 'exact', head: true })
      .in('backtest_id', backtestIds)
    if (tradeRes.error) {
      console.error('[getStrategyDeletePreview trades]', tradeRes.error)
      return { ok: false, error: 'preview_failed' as const }
    }
    trades = tradeRes.count ?? 0
  }

  return {
    ok: true as const,
    backtests: backtestIds.length,
    trades,
  }
}

// Hard delete the strategy AND all of its backtests + trades + notes. The
// soft-delete (archive) path is preferred; this is the "actually clean it
// up" escape hatch behind a typed-DELETE confirmation in the UI.
export async function deleteStrategy(strategyId: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' as const }

  // Look up the name first so we can scoop up backtests that match by name
  // (the runner sometimes writes strategy_name without strategy_id).
  const stratRes = await supabase
    .from('strategies')
    .select('id, name')
    .eq('id', strategyId)
    .maybeSingle()
  if (stratRes.error) {
    console.error('[deleteStrategy lookup]', stratRes.error)
    return { ok: false, error: 'delete_failed' as const }
  }
  if (!stratRes.data) return { ok: false, error: 'not_found' as const }
  const name = stratRes.data.name

  let backtestQuery = supabase
    .from('backtests')
    .select('id')
  if (name) backtestQuery = backtestQuery.or(`strategy_id.eq.${strategyId},strategy_name.eq.${name}`)
  else backtestQuery = backtestQuery.eq('strategy_id', strategyId)
  const btRes = await backtestQuery
  if (btRes.error) {
    console.error('[deleteStrategy backtests lookup]', btRes.error)
    return { ok: false, error: 'delete_failed' as const }
  }
  const backtestIds = (btRes.data ?? []).map((b) => b.id)

  // Children first so we don't leave dangling rows if a later step fails.
  if (backtestIds.length > 0) {
    const tradesDel = await supabase
      .from('trades')
      .delete()
      .in('backtest_id', backtestIds)
    if (tradesDel.error) {
      console.error('[deleteStrategy trades]', tradesDel.error)
      return { ok: false, error: 'delete_failed' as const }
    }

    const btNotesDel = await supabase
      .from('notes')
      .delete()
      .eq('target_type', 'backtest')
      .in('target_id', backtestIds)
    if (btNotesDel.error) {
      console.error('[deleteStrategy backtest notes]', btNotesDel.error)
      return { ok: false, error: 'delete_failed' as const }
    }

    const btDel = await supabase
      .from('backtests')
      .delete()
      .in('id', backtestIds)
    if (btDel.error) {
      console.error('[deleteStrategy backtests]', btDel.error)
      return { ok: false, error: 'delete_failed' as const }
    }
  }

  const stratNotesDel = await supabase
    .from('notes')
    .delete()
    .eq('target_type', 'strategy')
    .eq('target_id', strategyId)
  if (stratNotesDel.error) {
    console.error('[deleteStrategy strategy notes]', stratNotesDel.error)
    return { ok: false, error: 'delete_failed' as const }
  }

  const { error } = await supabase
    .from('strategies')
    .delete()
    .eq('id', strategyId)

  if (error) {
    console.error('[deleteStrategy]', error)
    return { ok: false, error: 'delete_failed' as const }
  }

  revalidatePath('/strategies')
  revalidatePath('/backtests')
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

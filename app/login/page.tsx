'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

function LoginForm() {
  const searchParams = useSearchParams()
  const isUnauthorized = searchParams.get('error') === 'unauthorized'

  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('loading')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setErrorMsg(error.message)
      setStatus('error')
    } else {
      setStatus('sent')
    }
  }

  return (
    <div className="rounded border border-border bg-card p-6">
      {isUnauthorized && (
        <div className="mb-4 rounded border border-[var(--negative)]/30 bg-[var(--negative)]/10 px-3 py-2 text-xs text-[var(--negative)]">
          This email is not authorized to access this system.
        </div>
      )}

      {status === 'sent' ? (
        <div className="text-center py-2">
          <div className="text-sm font-medium mb-1">Check your email</div>
          <div className="text-xs text-muted-foreground">
            Magic link sent to{' '}
            <span className="text-foreground font-mono">{email}</span>
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-sm font-semibold mb-1">Sign in</h1>
          <p className="text-xs text-muted-foreground mb-5">
            Enter your email to receive a magic link.
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            />
            {status === 'error' && (
              <p className="text-xs text-[var(--negative)]">{errorMsg}</p>
            )}
            <Button
              type="submit"
              disabled={status === 'loading'}
              className="w-full text-xs h-8"
            >
              {status === 'loading' ? 'Sending…' : 'Send magic link'}
            </Button>
          </form>
        </>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Branding */}
        <div className="flex items-center gap-2 mb-8">
          <div className="flex h-8 w-8 items-center justify-center rounded border border-border bg-card">
            <TrendingUp className="h-4 w-4 text-foreground" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight leading-none">
              Accession Trading Lab
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Futures Dashboard</div>
          </div>
        </div>

        <Suspense fallback={<div className="rounded border border-border bg-card p-6 text-xs text-muted-foreground">Loading…</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  LayoutDashboard,
  BookOpen,
  FlaskConical,
  Radio,
  Activity,
  LogOut,
} from 'lucide-react'

const navItems = [
  { href: '/',            label: 'Overview',   icon: LayoutDashboard },
  { href: '/strategies',  label: 'Strategies', icon: BookOpen        },
  { href: '/backtests',   label: 'Backtests',  icon: FlaskConical    },
  { href: '/live',        label: 'Live',       icon: Radio           },
  { href: '/activity',    label: 'Activity',   icon: Activity        },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <aside className="flex h-screen w-[200px] shrink-0 flex-col border-r border-border bg-[var(--sidebar)]">
      {/* Branding — A|P mark */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-card">
          <span className="font-light text-[11px] tracking-[0.05em] text-foreground/90">
            A<span className="mx-px text-foreground/50">|</span>P
          </span>
        </div>
        <span className="text-[11px] font-normal leading-none tracking-tight">
          Accession<br />
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Trading Lab</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'relative flex items-center gap-2.5 rounded px-2 py-1.5 text-xs transition-colors',
                active
                  ? 'bg-[var(--sidebar-accent)] text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground'
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--accent)]"
                />
              )}
              <Icon className={cn('h-3.5 w-3.5 shrink-0', active && 'text-[var(--accent)]')} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Sign out */}
      <div className="border-t border-border px-2 py-2">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-[var(--sidebar-accent)] hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}

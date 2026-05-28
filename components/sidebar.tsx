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
  TrendingUp,
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
      {/* Branding */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-card">
          <TrendingUp className="h-3 w-3" />
        </div>
        <span className="text-xs font-semibold tracking-tight leading-none">
          Accession<br />
          <span className="font-normal text-muted-foreground">Trading Lab</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 rounded px-2 py-1.5 text-xs transition-colors',
              isActive(href)
                ? 'bg-[var(--sidebar-accent)] text-foreground font-medium'
                : 'text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
          </Link>
        ))}
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

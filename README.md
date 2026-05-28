# Accession Trading Lab

Read-mostly dashboard for a futures algorithmic trading system. A separate
Python system writes to a Supabase database; this Next.js app reads from the
same DB. The dashboard only writes notes and strategy status labels — it never
controls or triggers the trading system.

**Stack:** Next.js 14 (App Router), TypeScript, Tailwind v4, shadcn/ui,
`@supabase/ssr` (magic-link email auth), recharts, lucide-react, Shiki (SSR
syntax highlighting).

**Pages:** `/` overview, `/strategies` + `/strategies/[id]`, `/backtests` +
`/backtests/[id]`, `/activity` (realtime log).

## Setup

```bash
git clone https://github.com/bryceAP/accession-trading-lab.git
cd accession-trading-lab
npm install
cp .env.local.example .env.local   # fill in real values
npm run dev                        # http://localhost:3000
```

## Required env vars

All three are required for both local dev and production:

| Name                            | Where it's used                          | Where to get it                                            |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase server + browser clients        | Supabase → Project Settings → API → **Project URL**        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase server + browser clients        | Supabase → Project Settings → API → **anon (public) key**  |
| `ALLOWED_EMAILS`                | `middleware.ts` allow-list (csv)         | Whoever should be able to sign in (e.g. `a@x.com,b@y.com`) |

The two `NEXT_PUBLIC_*` vars are intentionally public (they ship to the
browser). The Supabase **service role key is never used** by this app — writes
are gated by RLS policies, not by service-role bypass.

## Database

Tables (managed by the Python writer, not this app): `strategies`, `backtests`,
`trades`, `events`, `paper_status`, `notes`.

**RLS expectations** for the anon-key + magic-link session:

- `SELECT` allowed for `authenticated` on all tables read by the dashboard.
- `INSERT` on `notes` and `UPDATE`/`DELETE` on `strategies` allowed for
  `authenticated` (these are the only writes the dashboard performs).
- For `/activity` realtime, add the `events` table to the `supabase_realtime`
  publication.

## Auth

Magic-link email via Supabase. Sign-in happens at `/login`; the callback at
`/auth/callback` exchanges the code for a session. `middleware.ts` then enforces
two checks on every request:

1. The session cookie must be valid.
2. The signed-in email must appear in `ALLOWED_EMAILS`.

If either fails, the user is signed out and redirected to `/login`.

## Scripts

```bash
npm run dev      # next dev
npm run build    # next build (production bundle)
npm run start    # next start (serve production build)
npm run lint     # next lint
```

## Deploy to Vercel

See the deployment notes in the project chat / handoff doc — short version:

1. Push to GitHub (this repo: `bryceAP/accession-trading-lab`).
2. Import the repo at <https://vercel.com/new>.
3. Set all three env vars under **Project Settings → Environment Variables**
   (Production + Preview + Development scopes).
4. Add the Vercel production domain to Supabase **Authentication → URL
   Configuration → Site URL** and **Redirect URLs** so magic links work.
5. Deploy.

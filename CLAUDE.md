# CLAUDE.md — Harmony Homecare Agency Lead Gen & Email Automation

## Business Context
- **Agency:** Harmony Homecare Agency, LLC — NJ DDD Community Care Program provider
- **Location:** 1852 Burlington Mt-Holy Road, Westampton, NJ 08060 (Burlington County)
- **Services:** ISS, CBS, Respite Care | Medicaid #1084411 | NPI #1922869536
- **Admin:** Nate Ojugo | hhcare.nj@gmail.com | 609-755-5593
- **Outreach email:** outreach@harmonycarenj.org (forwards to hhcare.nj@gmail.com via Namecheap)
- **Website:** harmonycarenj.org

## Purpose
Automate outreach to NJ DDD Support Coordinators (SCs) — the primary referral source for new clients. Features: contact dashboard, email templates with merge tags, batch campaign sending, sent email log.

## Infrastructure
- **GitHub:** https://github.com/hhcarenj/harmony-outreach
- **Vercel:** https://harmony-outreach.vercel.app
- **Supabase:** Project `HHA- Website`, ID `skpwjwluxfkivxnlfpqb`, region us-east-1
- **Email:** Resend — domain `harmonycarenj.org` verified (SPF/DKIM/DMARC)
- **Framework:** Next.js 14 (Pages Router)

## Environment Variables
| Key | Where | Notes |
|-----|-------|-------|
| `RESEND_API_KEY` | Vercel + `.env.local` | Server-side only — never expose to browser |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | Safe for client-side |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local` | Safe for client-side (RLS enforced) |

Never commit `.env.local` — already in `.gitignore`.

## Supabase Schema
Four tables, all with RLS + anon/authenticated ALL policies:
- `sc_contacts` — 99 SC contacts seeded (agency_name, email, phone, website, counties_served, languages, status: new|contacted|replied|converted)
- `email_templates` — name, subject, body with merge tags `{{agency_name}}`, `{{contact_name}}`
- `sent_emails` — audit log (contact_id, template_id, to_email, subject, status, resend_id)
- `campaigns` — template_id, status: draft|sending|complete, sent_count

## Key Architecture Rules
- **Resend API calls MUST go through a Next.js API route** — never call from browser
- **Supabase anon key is safe client-side** — use `@supabase/supabase-js`, not raw fetch
- **Batch sending:** default 10/batch, 3s between batches, 500ms between individual sends
- **From address:** `outreach@harmonycarenj.org`
- **CAN-SPAM:** every email must include physical address and unsubscribe note

## Known Fix
Do NOT use raw `fetch()` against Supabase REST API — use the official client:
```js
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const { data, error } = await supabase.from('sc_contacts').select('*')
```

## Deployment Workflow
1. `git add <files> && git commit`
2. `git push origin main`
3. `~/.npm-global/bin/vercel --prod` — manual deploy (no auto-deploy on push)

## Tooling (non-standard paths)
- Vercel CLI: `~/.npm-global/bin/vercel`
- gh CLI: `/Users/nateojugo/pinokio/bin/miniconda/bin/gh`

## Lessons Learned
- `vercel link` and `gh auth login` require interactive terminal — user must run directly, not via bash tool
- `npm i -g` fails without sudo on `/usr/local` prefix — fix: `npm config set prefix ~/.npm-global` first
- `sudo` always fails in this environment (requires TTY) — never attempt it
- Always use full paths for CLI tools not on system PATH

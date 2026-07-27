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
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel + `.env.local` | **Secret — server-only, never expose.** Bypasses RLS; required by cron/API routes since CRM tables are staff-only |

Never commit `.env.local` — already in `.gitignore`.

## Access Control
The dashboard holds client PII and staff background-check records, so it is **not** public.

- **Browser** → anon key **+ a signed-in Supabase Auth session**. The anon key alone reads nothing.
- **Server (cron, API routes)** → `SUPABASE_SERVICE_ROLE_KEY` via `lib/supabaseServer.js` (`serverSupabase()`). Cron has no user session, so it must bypass RLS this way. **Never import that module from browser code.**
- **CRM table policies** grant access to `authenticated` AND `is_staff()` — being logged in is not enough. A user must have a row in `app_staff`, added by an admin. This holds even if Supabase self-signup gets switched on.
- **Adding a staff member:** create the user in Supabase → Authentication → Users, then insert their `user_id` into `app_staff`.
- Public marketing-site tables (`assessments`, `bookings`, `careers`, `brochure_requests`, `chat_leads`, `sc_inquiries`) keep their own anon INSERT policies — do not lock these or the website's forms break.

## Supabase Schema
CRM tables (RLS, staff-only):
- `sc_contacts` — SC contacts (agency_name, email, phone, website, counties_served, languages, status: new|contacted|replied|converted)
- `email_templates` — name, subject, body with merge tags `{{agency_name}}`, `{{contact_name}}`
- `sent_emails` — audit log (contact_id, template_id, to_email, subject, status, resend_id)
- `campaigns` — template_id, status: draft|sending|complete, sent_count
- `email_sequences`, `sequence_email_overrides`, `organizations`, `outreach_activities`, `followup_tasks`

Care Management tables (RLS, staff-only):
- `clients` — name, address, age, sex, phone, date_service_started, SC details, optional `sc_contact_id` → `sc_contacts`, status: active|inactive|discharged
- `dsps` — employees: contact info, hire_date, drug screen / fingerprint / CDS scheduled+completed dates, medication training, HHA/CNA/CPR/driver's license expirations
- `client_dsp_assignments` — join table; indexed both ways, partial unique index on `(client_id, dsp_id) WHERE status='active'` so a pair has one active assignment but keeps ended ones as history
- `client_guardians` — legal guardians, many per client (co-guardian parents, agency/court-appointed): name, relationship, phone, email. `ON DELETE CASCADE` from `clients`, FK indexed. Edited as buffered rows in the client form and reconciled on save (upsert existing / insert new / delete removed)

### DSP Compliance Rule
Lives in `lib/compliance.js`, shared by the UI badges and the daily cron so it can't drift.

- **Compliant** ⟺ drug screen **completed** AND fingerprinting **completed**. Nothing else affects it.
- This is about **completion, not scheduling** — a new DSP with nothing booked is *not* compliant. Scheduled dates only sharpen the message ("12 days past its scheduled date" vs "nothing scheduled yet").
- **Advisory** (small red ⚑ tag, still compliant): College of Direct Support incomplete = high risk; any certification expired or expiring within 30 days.
- Certifications are nullable per DSP — a blank date means "not applicable", never "missing".
- Inactive DSPs are excluded from alerts.

Add new hard requirements to `REQUIRED_CHECKS`, advisory ones to `ADVISORY_CHECKS`.

## Email Assets
Outbound email images are served from **public Supabase Storage**, not this app's domain (`resolveLogoUrl` in `lib/emailHtml.js`). The dashboard is access-controlled; serving assets from it would break the logo in every email. Do not move them back to `public/`.

## Key Architecture Rules
- **Resend API calls MUST go through a Next.js API route** — never call from browser
- **Supabase anon key is safe client-side** — use `@supabase/supabase-js`, not raw fetch. The **service-role** key is not: server-only, via `lib/supabaseServer.js`
- **New CRM tables must get staff-only policies** (`authenticated` + `is_staff()`), never `TO anon`
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

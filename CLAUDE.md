# Export System — Project Instructions

## Project
Bastel Pvt Ltd export document management platform.  
Repo: `bastelpvtltd-png/Systerm` (GitHub)  
Live: `https://export-system.vercel.app`  
Stack: Next.js 14 Pages Router · TypeScript · Supabase PostgreSQL · Vercel Hobby

## Language
User communicates in Romanized Sinhala. Reply in the same mix (Sinhala + English for technical terms).

## Permissions
Zero-prompt policy — proceed through any task without stopping to ask for confirmation.  
Token locations: check `.env.local` first, then `tokens-and-api-calls.txt` in the repo root.

## Credentials (always verify from file, not from memory)
- **Supabase project:** `cxbvfvsbcdvaoinvalqv`  
- **Supabase Management API token:** in `.env.local` as `SUPABASE_ACCESS_TOKEN`  
  → Endpoint: `POST https://api.supabase.com/v1/projects/cxbvfvsbcdvaoinvalqv/database/query`  
- **Vercel token:** use the one in `tokens-and-api-calls.txt` (the `.env` and `LOCAL_SETUP_NOTES.txt` tokens are expired)  
- **GitHub push:** must use a `bastelpvtltd-png` account token with `repo` + `workflow` scopes

## Key conventions
- All admin pages live in `src/pages/admin/`
- API routes in `src/pages/api/`
- Shared logic in `src/lib/`
- Components in `src/components/admin/`
- Auth: every API route uses `requireAuth(req)` from `@/lib/serverAuth`; every fetch from the client must include `authHeader()`
- After any API route gets a new auth guard, grep all callers and confirm they send `authHeader()`
- Vercel Hobby plan: cron in `vercel.json` can only be daily — use the GitHub Actions workflow (`.github/workflows/automation-ping.yml`) for hourly jobs

## Messages system
Messages live in the **FloatingChat popup** (AdminLayout.tsx) — there is no `/admin/messages` page. The `messages` table has `recipient_id` (null = broadcast, uuid = DM) and joins `message_reads` for seen status.

## Session memory
At the end of each work session, save what was completed to the memory system at  
`C:\Users\USER\.claude\projects\C--Users-USER-Desktop-algo-trading-platform\memory\`  
as a `project_*.md` entry so the next session starts with full context.

## Workflow
1. Implement the spec
2. `npx tsc --noEmit` — fix all type errors before committing
3. Commit with a clear message
4. `git push` using the `bastelpvtltd-png` token
5. Check Vercel deployment reached `READY` via the Vercel API
6. Report what was shipped vs. what's still pending — never overclaim completion

# Export Management System

## Tech Stack
- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Deploy:** Vercel
- **Brand:** Dark Blue (#0D1B2A) + Green (#22A87A) + White

---

## Setup Steps

### 1. Supabase Setup
1. Go to https://supabase.com → Create new project
2. Go to SQL Editor → paste contents of `supabase_schema.sql` → Run
3. Copy your Project URL and anon key

### 2. Local Setup
```bash
npm install
```

Create `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

```bash
npm run dev
```

### 3. Deploy to Vercel
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USER/export-system.git
git push -u origin main
```
Then connect repo to Vercel and add env variables.

---

## Pages
| Route | Description |
|-------|-------------|
| `/` | Login (with IP tracking) |
| `/admin` | Admin Dashboard + Summary |
| `/admin/shipments` | Shipments CRUD |
| `/admin/cusdec` | CUSDEC management |
| `/admin/cdn` | CDN management |
| `/admin/financials` | Financial records |
| `/admin/users` | User management |
| `/admin/logs` | Login logs + IP tracking |
| `/worker` | Worker task dashboard |
| `/profile` | Profile edit |

---

## Features Built
- [x] Login with IP tracking + logs
- [x] Admin / Worker role separation
- [x] Shipments (shipper, wharf, driver details)
- [x] Login logs with IP
- [x] User management
- [x] Worker task dashboard
- [x] Profile edit (username + password)
- [ ] CUSDEC (coming next)
- [ ] CDN, Boat Note, Trico (coming next)
- [ ] Financials (coming next)
- [ ] Document uploads (coming next)

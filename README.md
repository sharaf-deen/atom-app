# Atom Jiu-Jitsu — PWA MVP Starter

This starter gives you a **testable MVP** with:
- Supabase Auth (email/password)
- Profiles with roles: `admin`, `coach`, `assistant_coach`, `member`
- Subscriptions (standard) and Drop-in packs (classes + 45-day expiry)
- User Profile page with **QR code**
- Tablet **QR Scanner** page that hits a server API to **validate access** and **record attendance** (and decrement classes for drop-in)
- Admin-only Dashboard (very minimal)
- Tailwind + Next.js (App Router)

## 0) Prerequisites
- Node.js LTS (>= 18)
- A Supabase project (get **Project URL**, **Anon key**, and **Service Role key**)
- (Optional) Vercel account for hosting

## 1) Set up Supabase
1. Open Supabase SQL editor and run the SQL in `supabase/sql/schema.sql`.
2. Go to **Authentication → Providers** and keep only Email enabled for now.
3. Create your own user by signing up in the app after you run it. Then set your role to admin:
   ```sql
   update public.profiles set role = 'admin' where email = 'YOUR_EMAIL_HERE';
   ```

## 2) Configure environment
Copy `.env.example` to `.env.local` and fill the values from your Supabase dashboard:
```
cp .env.example .env.local
```

## 3) Install and run
```
npm install
npm run dev
```
Open http://localhost:3000

## 4) Test flow
- Sign up with an email/password.
- You will appear in **profiles** with role `member`. Switch it to `admin` in SQL to see the dashboard.
- Go to **/profile** to see your QR code.
- Open **/scan** (preferably on a tablet). Scan the QR code from a user; it will:
  - Check if they have an **active subscription** (not expired), or an active **drop-in pack** (classes > 0 and not past expiry).
  - Insert an **attendance** row (allowed/denied).
  - If drop-in, it **decrements one class**.

## 5) Deploy (optional)
- Push to GitHub and deploy on Vercel.
- Set env vars in Vercel (including `SUPABASE_SERVICE_ROLE_KEY` as a **protected** secret).

> **Important security note:** The **Service Role key must never be exposed to the browser**. In this starter, it is used only in the server API route `/api/scan`.
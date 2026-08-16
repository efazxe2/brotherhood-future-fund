# Brotherhood Future Fund

A live, installable fund tracker for a 12-month rotating share fund.
Real-time sync via Supabase, installable as a PWA on iOS and Android,
no Claude account required for anyone who opens the link.

This package is meant to be handed to **Claude Code** (or run manually
if you're comfortable with a terminal). It is not something you run
inside claude.ai chat — it needs a real hosting step.

---

## What's in this folder

```
brotherhood-future-fund/
├── src/
│   ├── App.jsx            ← the whole app (UI + logic)
│   ├── main.jsx            ← entry point, registers the PWA service worker
│   ├── supabaseClient.js   ← connects to your Supabase project
│   └── index.css
├── public/
│   ├── icon-192.png        ← placeholder app icon (swap for your own)
│   ├── icon-512.png
│   └── apple-touch-icon.png
├── supabase/
│   └── schema.sql          ← run once in Supabase to create your tables
├── .env.example             ← copy to .env and fill in your Supabase keys
├── vite.config.js           ← PWA config (manifest + service worker)
└── package.json
```

---

## 1. Set up Supabase (5 minutes)

1. Go to [supabase.com](https://supabase.com) → **New Project**.
   Name it, set a database password (save it), pick a nearby region.
2. Once it's ready, open **SQL Editor → New query**, paste the entire
   contents of `supabase/schema.sql`, and click **Run**.
   This creates the `members`, `payments`, and `late_fees` tables,
   seeds your 18 members, and turns on real-time sync.
   *(Skip the `insert into members...` and `insert into payments...`
   blocks if you already ran the schema once before — they'll fail on
   duplicate IDs the second time.)*
3. Go to **Project Settings → API**. Copy:
   - **Project URL**
   - **anon public** key

---

## 2. Configure the app

```bash
cd brotherhood-future-fund
cp .env.example .env
```

Open `.env` and paste in your Project URL and anon key:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_ADMIN_PIN=27198
```

---

## 3. Run it locally to confirm it works

```bash
npm install
npm run dev
```

Open the local URL it prints (usually `http://localhost:5173`).
You should see the app load your Supabase data. Try tapping "Member"
→ enter the PIN → confirm Admin mode unlocks and edits save.

---

## 4. Deploy for real (Vercel — free)

The easiest path:

1. Push this folder to a new GitHub repo.
2. Go to [vercel.com](https://vercel.com) → **New Project** → import
   that repo.
3. In the Vercel project's **Environment Variables** settings, add the
   same three variables from your `.env` file
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_PIN`).
4. Click **Deploy**. You'll get a URL like
   `brotherhood-fund.vercel.app` — that's your permanent link.

No Claude account, no sign-in, no app download needed for anyone who
opens that link — it's a completely independent website.

*(If you're using Claude Code for this step, just tell it: "deploy
this to Vercel and set the environment variables from my .env file" —
it can run all of the above for you.)*

---

## 5. Install it as an app (PWA)

**iPhone (Safari):**
Open your Vercel link → Share icon → **Add to Home Screen**.

**Android (Chrome):**
Open your Vercel link → **⋮** menu → **Install app** (Chrome will
often prompt this automatically).

Because this is a real PWA (not a claude.ai artifact), you'll get:
- Your own icon and app name on the home screen
- No browser address bar when opened
- The last-loaded data still shows if opened with no signal, then
  re-syncs automatically once back online

---

## Customizing the app icon

The icons in `public/` are simple placeholders. Swap
`icon-192.png`, `icon-512.png`, and `apple-touch-icon.png` for your
own artwork (same filenames, same folder) before deploying, or ask
Claude Code to generate new ones.

---

## Notes on security

- The Supabase `anon` key is safe to expose in frontend code by
  design — that's how Supabase is meant to be used client-side.
- The current database policies (`supabase/schema.sql`) allow *any*
  request using that key to read and write all tables. The app's PIN
  screen is the only thing stopping a casual viewer from editing —
  someone who inspects the deployed code could technically bypass it.
  For a small trusted group this is a reasonable tradeoff; if you
  want real access control later, that means adding Supabase Auth
  and rewriting the policies to check `auth.uid()` — worth asking
  Claude Code for when you're ready.
- Unlike the claude.ai artifact version, deleting or resetting this
  app's data is fully in your control (via the Supabase dashboard),
  and nothing gets wiped just by changing hosting.

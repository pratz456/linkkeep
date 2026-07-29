# LinkKeep

Manage your LinkedIn connections locally: sign in with LinkedIn, import Connections.csv, then organize people with tags, notes, status, and follow-up dates.

## Important LinkedIn API limitation

LinkedIn **does not** let standard developer apps read your connection list. Self-serve OAuth only covers:

- Sign In (`openid`, `profile`, `email`)
- Share on LinkedIn (`w_member_social`)

The Connections API (`r_1st_connections`) requires LinkedIn partner approval. LinkKeep therefore:

1. **Connects** your account with Sign In with LinkedIn
2. **Imports** people from LinkedIn’s official **Connections.csv** data export
3. **Optionally tries** API sync if you later get partner access (will return a clear 403 otherwise)

## Live deployment

- App: https://linkkeep-psi.vercel.app
- Repo: https://github.com/pratz456/linkkeep
- Database: Neon Postgres

After deploy, add this LinkedIn redirect URL in your app **Auth** settings:

`https://linkkeep-psi.vercel.app/api/auth/callback/linkedin`

## Auto-sync (PhantomBuster / Dux-Soup)

LinkedIn does not allow apps to read your connection list via OAuth. For ongoing updates, connect a browser-automation tool’s webhook to LinkKeep:

1. Sign in to https://linkkeep-psi.vercel.app/dashboard
2. Click **Auto-sync setup**
3. Copy the PhantomBuster or Dux-Soup webhook URL

### PhantomBuster
- Use [LinkedIn Connections Export](https://phantombuster.com/automations/linkedin/12670/linkedin-connections-export)
- Paste webhook URL under Advanced → Webhooks
- Schedule the Phantom (daily/weekly) so LinkKeep stays updated

### Dux-Soup (Turbo/Cloud)
- Options → Connect → Webhooks → paste URL
- Enable **Visit** + **Scan**
- Scan or visit connections in LinkedIn; 1st-degree profiles stream into LinkKeep

## Setup

```bash
cd linkedin-connections
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Without LinkedIn credentials (demo)

Leave `AUTH_LINKEDIN_ID` / `AUTH_LINKEDIN_SECRET` empty and click **Try demo workspace**. You can import CSV and manage connections locally.

### With LinkedIn Sign In

1. Create an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps)
2. Under **Products**, request **Sign In with LinkedIn using OpenID Connect**
3. Under **Auth**, add redirect URL:
   `http://localhost:3000/api/auth/callback/linkedin`
4. Put Client ID and Client Secret in `.env.local`:

```env
AUTH_SECRET=any-long-random-string
AUTH_URL=http://localhost:3000
AUTH_LINKEDIN_ID=your_client_id
AUTH_LINKEDIN_SECRET=your_client_secret
```

5. Restart `npm run dev` and click **Connect LinkedIn**

Generate a secret with:

```bash
openssl rand -base64 32
```

### Importing connections

1. LinkedIn → **Me** → **Settings & Privacy** → **Data privacy** → **Get a copy of your data**
2. Select **Connections** only, request the archive
3. Download and upload `Connections.csv` via **Import CSV** in the dashboard

## Stack

- Next.js (App Router) + TypeScript
- Auth.js (NextAuth v5) + LinkedIn OpenID Connect
- SQLite via Drizzle + better-sqlite3 (stored in `data/app.db`)

## Scripts

| Command        | Description              |
| -------------- | ------------------------ |
| `npm run dev`  | Start local server       |
| `npm run build`| Production build         |
| `npm run start`| Run production server    |

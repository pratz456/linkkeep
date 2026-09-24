# Morrow

Morrow is a calm, connector-ready work-life dashboard. It turns changing context
into prioritized views for today, this week, and this month while keeping major
outcomes visibly separate from smaller commitments.

## MVP behavior

- Defaults to an action-oriented Today brief with persistent Week/Month horizons
- Shows at most three major outcomes, five quick actions, actionable signals,
  the next meeting, follow-ups, and a recoverable focus session
- Prioritizes with deterministic urgency, impact, commitment, dependency,
  freshness, schedule-fit, staleness, blocker, and manual-adjustment factors
- Exposes “Why this?” factor points, normalized provenance, confidence, and
  exclusive primary-horizon reasoning for every task
- Keeps work, personal, and wellbeing commitments in one filterable workspace
- Supports keyboard search, responsive navigation, task completion/defer with
  Undo, task details, and manual capture
- Persists manual tasks and completion state in the current browser
- Ships with an explicitly labeled sample workspace for product evaluation

## Connector honesty

The hosted production preview does **not** claim live access to Gmail, Slack,
Google Calendar/Drive, Notion, Granola, or LinkedIn connections. Personal local
mode can authorize and poll Gmail metadata, Google Calendar events, Google
Drive metadata, selected Slack channels, and explicitly shared Notion pages.
Cursor MCP grants belong to the agent runtime and are never reused by the app.

The connector catalog separates public metadata from server configuration:

- `src/lib/connectors/catalog.ts` — safe provider names and capabilities
- `src/lib/connectors/runtime.ts` — server-only environment access
- `src/lib/connectors/status.ts` — redacted connection status
- `src/lib/connectors/security.ts` — signed 10-minute OAuth state, PKCE, and
  authenticated AES-256-GCM token envelopes
- `src/lib/connectors/providers.ts` — provider-specific authorization exchange
- `src/lib/connectors/store.ts` — workspace-scoped encrypted grant storage and
  idempotent durable sync-job enqueueing
- `src/lib/connectors/local-sync.ts` — bounded local polling and normalization
- `src/lib/connectors/adapter.ts` — worker-side adapter contract
- `src/app/api/connectors/route.ts` — no-store status endpoint
- `src/app/api/connectors/sync/route.ts` — same-origin personal-local sync
- `src/app/api/connectors/[provider]/*` — authorize, callback, and local-delete
  seams

Authorization routes are deliberately disabled in production and require
`WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION=true` in development. Client
credentials are never called “connected”; a source becomes **Authorized** only
after a valid state-bound callback stores an encrypted token, and becomes
**Live** only after a successful sync. Personal local mode syncs in the local
Next.js process; hosted production still requires a durable worker.

Current provider constraints:

- Gmail asks only for `gmail.metadata`. Personal Google test users may set
  `WORKLIFE_GMAIL_VERIFICATION_STATUS=local_testing`; a public app still needs
  Google restricted-scope verification/security review.
- Drive asks for metadata-only access and never downloads file content.
- Slack defaults to a selected-channel bot model, not user DMs or full search.
- Notion is limited to content explicitly shared with the integration.
- Granola is export-only until a supported app-runtime contract exists.
- LinkedIn relationship sync remains partner-gated; official CSV import is the
  supported fallback in the retired product.

## Security release gates

The inherited LinkKeep auth, connection, integration, demo-login, and webhook
routes are unconditionally answered with `404` by `src/proxy.ts`. Their
query-token webhook model and plaintext Auth.js token columns are not part of
Morrow. A preview deployment must use a clean database and must not inherit
LinkKeep `AUTH_*`, webhook, or stored-token configuration.

Hosted production connectors remain blocked until the product has authenticated
identity and tenant membership, RLS/scoped repositories, KMS-backed envelope
encryption and rotation, verified provider webhooks, an isolated durable worker,
remote revocation plus derived-data deletion, retention/audit controls, and a
nonce/hash CSP. Personal local mode is intentionally single-user and uses a
machine-local encryption key.

Connector content is normalized into bounded, plain-text, explicitly
`untrusted_connector_content` records. No LLM is called. Future model work must
keep source text out of system instructions and expose no network or mutation
tools without deterministic re-authorization and human confirmation.

Manual preview tasks use namespaced browser storage. They should not contain
sensitive work data; the Sources panel includes a clear-local-workspace action.

## Personal local mode on macOS

Requirements: Node.js 20 or newer and npm. Docker is not required; Morrow uses
PGlite, a Postgres-compatible database persisted under `./data/morrow`.

```bash
npm install
npm run local
```

Open [http://localhost:3000](http://localhost:3000).

The first run creates `.env.local` with local database, session, and encryption
settings. Add OAuth credentials to that file, restart `npm run local`, then use
**Sources → Connect**. Consent is required once per source; encrypted refresh
tokens keep later syncs automatic while the local app is open.

Create provider apps and register these exact callback URLs:

```text
http://localhost:3000/api/connectors/gmail/callback
http://localhost:3000/api/connectors/calendar/callback
http://localhost:3000/api/connectors/drive/callback
http://localhost:3000/api/connectors/slack/callback
http://localhost:3000/api/connectors/notion/callback
```

- Google: use one Web OAuth client, add your Google account as a test user,
  enable Gmail, Calendar, and Drive APIs, then set
  `WORKLIFE_GOOGLE_CLIENT_ID` and `WORKLIFE_GOOGLE_CLIENT_SECRET`.
- Slack: create an app with the bot scopes shown in `.env.example`, register the
  Slack callback, install it, and invite it only to channels Morrow may read.
- Notion: create a public integration, register the callback, set the client ID
  and secret, and explicitly share only the pages Morrow may read.

LinkedIn first-degree connections and Granola remain import-only because a
general public sync API is not available. Use **Sources → Import export** with
LinkedIn's official `Connections.csv` or a Granola Markdown/text/JSON export;
those imported actions remain local. OAuth credentials are never generated by
Morrow and cannot be copied from Cursor, Google, Slack, or Notion MCP access.

To regenerate only missing local settings:

```bash
npm run local:setup
```

## Durable processing seams

OAuth completion writes an idempotent `connector.initial_backfill` job to
`connectorSyncJobs`. Personal local mode consumes authorized sources through the
same-origin sync route after callback, on **Sync now**, and every five minutes
while the dashboard is open. `syncCheckpoints` reserves versioned
cursor/high-water state for a future hosted worker. Production should provision
Inngest, Trigger.dev, or an equivalent isolated service with per-account leases
and provider-specific verification.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Stack

- Next.js App Router and React
- TypeScript
- CSS Modules
- Vitest

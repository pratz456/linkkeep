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

The production preview does **not** claim live access to Gmail, Slack, Google
Calendar/Drive, Notion, Granola, or LinkedIn connections. Source status comes
from a server-only connector boundary and all demonstration context is labeled
sample data. Cursor MCP grants belong to the agent runtime and are never reused
by the deployed app.

The connector catalog separates public metadata from server configuration:

- `src/lib/connectors/catalog.ts` — safe provider names and capabilities
- `src/lib/connectors/runtime.ts` — server-only environment access
- `src/lib/connectors/status.ts` — redacted connection status
- `src/lib/connectors/security.ts` — signed 10-minute OAuth state, PKCE, and
  authenticated AES-256-GCM token envelopes
- `src/lib/connectors/providers.ts` — provider-specific authorization exchange
- `src/lib/connectors/store.ts` — workspace-scoped encrypted grant storage and
  idempotent durable sync-job enqueueing
- `src/lib/connectors/adapter.ts` — worker-side adapter contract
- `src/app/api/connectors/route.ts` — no-store status endpoint
- `src/app/api/connectors/[provider]/*` — authorize, callback, and local-delete
  seams

Authorization routes are deliberately disabled in production and require
`WORKLIFE_ENABLE_CONNECTOR_AUTHORIZATION=true` in development. Client
credentials are never called “connected”; a source becomes **Authorized** only
after a valid state-bound callback stores an encrypted token, and becomes
**Live** only after a durable worker records a successful sync.

Current provider constraints:

- Gmail remains setup-blocked until restricted-scope verification/security
  review is explicitly marked approved. The default seam asks only for
  `gmail.metadata`.
- Drive defaults to Picker plus `drive.file`, not broad account-wide access.
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

Real production connectors remain blocked until the product has authenticated
identity and tenant membership, RLS/scoped repositories, KMS-backed envelope
encryption and rotation, verified provider webhooks, an isolated durable worker,
remote revocation plus derived-data deletion, retention/audit controls, and a
nonce/hash CSP. The checked-in AES key seam is for local development only.

Connector content is normalized into bounded, plain-text, explicitly
`untrusted_connector_content` records. No LLM is called. Future model work must
keep source text out of system instructions and expose no network or mutation
tools without deterministic re-authorization and human confirmation.

Manual preview tasks use namespaced browser storage. They should not contain
sensitive work data; the Sources panel includes a clear-local-workspace action.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Provider callback paths are shown in the Sources panel and follow:

`/api/connectors/<gmail|calendar|drive|slack|notion>/callback`

Use an exact `WORKLIFE_APP_URL` origin. Missing credentials, verification,
Picker setup, signing secrets, Notion version, database, session secret,
encryption key, and worker handoff are surfaced as setup blockers rather than
silently ignored.

## Durable processing seams

OAuth completion writes an idempotent `connector.initial_backfill` job to
`connectorSyncJobs`; it never performs a backfill inside the callback request.
`syncCheckpoints` reserves versioned cursor/high-water state for future workers.
No worker is bundled or simulated, so authorized providers remain “sync
pending.” Production should provision Inngest, Trigger.dev, or an equivalent
isolated service with per-account leases and provider-specific verification.

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

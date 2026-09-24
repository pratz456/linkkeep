# Morrow

Morrow is a calm, connector-ready work-life dashboard. It turns changing context
into prioritized views for today, this week, and this month while keeping major
outcomes visibly separate from smaller commitments.

## MVP behavior

- Prioritizes open commitments by importance, due date, and supporting context
- Keeps work, personal, and wellbeing commitments in one filterable workspace
- Shows schedule shape, protected focus time, effort, and completion progress
- Supports search, task completion, task details, and manual task capture
- Persists manual tasks and completion state in the current browser
- Ships with an explicitly labeled sample workspace for product evaluation

## Connector honesty

The preview does **not** claim live access to Gmail, Slack, Google Calendar, or
Granola. Source status comes from a server-only connector boundary and the UI
labels all demonstration context as sample data.

The connector catalog separates public metadata from server configuration:

- `src/lib/connectors/catalog.ts` — safe provider names and capabilities
- `src/lib/connectors/runtime.ts` — server-only environment access
- `src/lib/connectors/status.ts` — redacted connection status
- `src/app/api/connectors/route.ts` — no-store status endpoint

OAuth credentials and provider tokens must remain in encrypted server-side
storage in a production deployment. Granola remains export-only until an
approved runtime API or export flow is available. The manual connector is the
only active input in this MVP.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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

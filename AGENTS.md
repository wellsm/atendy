# Atendy

WhatsApp ordering agent for small food businesses. Spec: `docs/specs/mvp.md`. Plans: `docs/plans/`.

## Commands

- install: `npm install`
- local db: `npm run db:up` (Postgres 16 on localhost:54322)
- dev: `npm run serve` (API) and `npm run web` (panel on http://localhost:3000; copy `packages/web/.env.example` to `packages/web/.env.local`)
- typecheck: `npm run typecheck`
- lint: `npm run prettify -- --log-level silent && npm run lint`
- test: `npm test` (uses database `atendy_tests` on the local Docker Postgres)
- admin scripts live in `packages/api/src/admin/scripts/`. Create store: `STORE_NAME="Pizzaria X" STORE_SLUG=pizzaria-x npm run admin:create-store -w @atendy/api` (inputs via env vars)
- demo data: `STORE_ID=<id> npm run admin:seed-demo -w @atendy/api` (demo pizzeria menu + 24h hours; once per store)
- store policy: `STORE_ID=<id> POLICY='{"max_item_qty":10,"min_order_cents":3000,"sop":"..."}' npm run admin:set-policy -w @atendy/api` (merges; `null` clears a key; keys in `StorePolicy`)

- web build: `npm run build -w @atendy/web` (SPA shell via TanStack Start prerender)

## Conventions

- Style follows `~/Freighthero/backend/docs/code-style-rules.md`.
- Modules live in `packages/api/src/<module>/` with `schemas/`, `types.ts`, `repository.ts`, and pure helpers in their own files.
- Naming: `kebab-case` files; `snake_case` tables/columns; `PascalCase` types/enums; `camelCase` functions; `UPPER_SNAKE_CASE` constants/env vars.
- Money in integer cents. Every tenant table carries `store_id`.
- Prefer `const enum`; prefer `type` unless Ez4 requires `interface`/`declare class`.
- Throw instead of logging. No `console.log` in `src/`.
- Return early. No abstraction before three concrete cases (exception: `WhatsAppProvider`, required by the spec).

## Pitfalls

- Destructure `Service.Context` in the handler parameter, never in the body: Ez4 bundles only the services named in the signature.
- Removing a column from an Ez4 schema changes only types; Postgres keeps the column. `DROP COLUMN` is manual.
- `ez4 run -- <files>` treats everything after `--` as script files. Pass admin inputs as env vars.
- `localOptions`/`testOptions` in `ez4.project.js` always point to Docker Postgres: `ez4 serve/run/test --local` create tables on that target. Never wire `EZ4_RAW_PG_DB_URL` (Neon) there; only `ez4 deploy` reads it. Admin scripts therefore run only against local data for now.
- Third-party webhook bodies must be typed `Object.Any` (`@ez4/schema`): a `Record<string, unknown>` or partial type makes the gateway validator strip fields, and handler tests (which call the function directly) do not catch it.
- `findOne` only accepts a unique key in `where`; use `findMany({ take: 1 })` for secondary indexes.
- The local queue emulator has no FIFO ordering or dedupe: debounce/echo ordering is only proven by tests and on AWS.
- Local serve runs on port 3746 (base path `/atendy-api-api`); 3736 is used by Freighthero. Evolution: 8081, Redis: 6381.
- Bot replies are stored as `pending:<id>` before sending and confirmed after; never send without that row (prevents double replies and false staff handoffs).
- `@ez4/raw-pg` does not create databases. `atendy_tests` comes from `infra/postgres/init.sql` (runs only on a fresh volume).
- Prices and totals come only from `priceItem`/`computeTotals` via `OrderRepository`; tools ignore any price the model sends.
- Tests never call OpenRouter (LLM or Jev): mock `OpenRouterClient.chat` / `JevClient.evaluate` (or `globalThis.fetch` in client tests) with `mock.method`.
- A turn that fails after a mutating tool ran is never replayed (`TurnError.retryable = false`): the handler hands off with `TECHNICAL_ERROR_REPLY`. Retryable failures go back to the queue until `attempt === maxAttempts`.
- New queue variables need a value in the `test` script (`ez4 test` refuses missing ones).
- Jev runs through OpenRouter's Decisions API at `https://openrouter.ai/api/alpha/decisions` (no `/v1`), same key as the LLM. Both responses carry `usage.cost` in USD; that is what `ai_calls.cost_usd` stores.
- Tools act on the "current order": the draft, else the conversation's `placed` order still inside `order_memory_hours`. Writes to a placed order go through `OrderRepository.editPlacedOrder` (transaction + `lock: true` + status check); never update a placed order outside it.
- A limit that needs a person throws `OrderError` with `handoffReason`; `executeTool` hands off and marks the turn mutated. Do not hand off in the repository.
- Panel auth: the store comes from the Clerk token's org (`o.id`, v1 `org_id`) via `StoreRepository.findByOrgId`; there is no custom `sid` claim. Admin routes check `ADMIN_USER_IDS` (Clerk user ids).
- `stores.active` is admin-controlled; the WhatsApp webhook drops every event of an inactive store. `accepting_orders` is the store's own switch.
- Ez4 refuses empty variables: `CLERK_JWT_KEY`, `ADMIN_USER_IDS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` need a value in `local.env` and in the `test` script. Tests sign Clerk tokens locally (`test/support/clerk.ts`) and mock `fetch` for Telegram.
- API CORS (`src/api.ts`) is a type literal: add the production web origin there when the panel is deployed.
- Panel sends (staff replies, order status messages) go through `sendStaffMessage` (`src/panel/send.ts`): pending row → send → confirm, stored as `author = 'staff'`. Never store them as `bot`: the queue's "already replied" check counts bot rows only. `claimPendingEcho` claims bot and staff pending rows.
- Order status changes from the panel go through `OrderRepository.setStatus` (locked transaction, transition table in `src/orders/status.ts`). Status first, customer message after (best effort, `notified`).
- Settings writes validate with the pure validators in `src/stores/settings.ts` (`SettingsError(field)` → 400 `context.field` via `withSettingsErrors`); hours and delivery are replaced in one transaction (`replaceHours`, `replaceDelivery`). `order_memory_hours` is admin-only (not in `PANEL_POLICY_KEYS`).
- WhatsApp instance create/connect/state/logout go through `StoreWhatsApp` (`src/panel/whatsapp.ts`), shared by the panel and `admin:connect-whatsapp`; it uses the global `EVOLUTION_API_KEY`, which never leaves the API. Sending uses the per-instance token.
- Menu writes from the panel go through `MenuRepository` (`createProduct`/`replaceProduct` save a product whole in one transaction and keep sent group/option ids after checking they belong to that product and group; categories and toggles are scoped by `store_id`). Validate with `src/menu/validation.ts` (`MenuError(field)` → 400 via `withMenuErrors`). `importMenu` is only for the demo seed and tests.
- Gateway bodies are camelCase in code and snake_case on the wire (`NamingStyle.SnakeCase`); the web client sends/reads snake_case.

## Never

- Commit, push, deploy or run migrations against Neon. The user does those.
- Add a dependency without asking.

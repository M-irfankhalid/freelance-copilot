# Progress Tracker

Living checklist of what is complete, in progress, and next.
Update this file every time a piece of work is finished.

## How we work

1. Frontend first: the complete UI is built with mock data only.
2. The user reviews the running app visually and verifies every screen.
3. Only after that verification does backend work begin, matching what the approved screens need.

Run it locally:

```bash
pnpm dev
```

Then open http://localhost:5173. Suggested review route: /signup → /onboarding → dashboard → jobs → job detail → matches → proposals → bids → analytics → logs → platforms → automation → profile → settings.

## Phase 0, Project Setup

- [x] PRD.md rewritten with full product vision (auto-bid, OpenRouter, onboarding, logs, bid insights)
- [x] DEVELOPMENT_PLAN.md restructured into 13 buildable phases
- [x] CLAUDE.md and README.md aligned with OpenRouter and auto-bid safety rules
- [x] Git repository initialized, remote added, baseline commit on main
- [x] Root .gitignore protecting .env, database files, and build output
- [x] .env.example template created
- [x] Unused template assets and dead files removed from apps/web

## Phase 1, Frontend, Mock Data Only

### Done — pending user visual verification

- [x] Application shell, sidebar, header, breadcrumbs, notifications menu
- [x] Design system components, shadcn style, Tailwind v4 theme (plus new: table, tabs, dialog, select, switch, checkbox, progress, textarea, label)
- [x] Dashboard page with KPIs, attention queue, match quality, activity feed
- [x] Shared domain types covering every screen (`src/lib/types.ts`)
- [x] Mock data layer per domain (`src/lib/data/`)
- [x] Jobs list: search, status filter, sort, scan button, manual add by URL or ID
- [x] Job detail: Freelancer style layout, client info, attachments, AI suggestion box with reasons, concerns, recommended bid range, competitor note, cached bid insights card with updated-time-ago and refresh button
- [x] Matches: score bands, matched vs missing skills, concerns, ignore action
- [x] Proposals: approval queue with approve/edit/regenerate, full list table, editor dialog
- [x] Bids: summary tiles, manual vs auto-bid badges, outcome statuses
- [x] Analytics: KPI cards, bids-per-week bar chart, outcome breakdown, proposals by status (accessible fallbacks included)
- [x] Logs: level and category filters, search, export button
- [x] Platforms: Freelancer.com and OpenRouter credential cards, masked previews, test connection buttons, model selector, usage meters, replace dialog
- [x] Automation: scan interval, pipeline toggles, auto-bid config off by default with score threshold, bid bounds, daily cap and usage meter, pause/resume, recent runs
- [x] Profile: import banner, basics, skills as search keywords, wants and not-wants filters, experience, portfolio, certifications, custom AI instructions
- [x] Settings: account, notification toggles, backup codes viewer, danger zone
- [x] Login with backup-code recovery dialog
- [x] Signup with one-time backup codes step requiring saved confirmation
- [x] Onboarding wizard: welcome, Freelancer token test, OpenRouter key test plus model pick, profile import, preferences with scan interval
- [x] Single-user brand block replaced demo workspace switcher; demo user centralized in `lib/data/user.ts`
- [x] Typecheck clean, lint clean, production build passing

### Blocked / Later

- [ ] User visual verification of all Phase 1 screens. The user chose to proceed to Phase 2 before a formal review session; the mock UI remains the contract for integration in Phase 3, so any visual changes wanted later should be raised before or during Phase 3.

## Phase 2, Backend Foundation

### Done

- [x] Strict TypeScript setup with its own tsconfig, typecheck, and build scripts
- [x] Zod-validated environment configuration, process refuses bad config at boot
- [x] Modular monolith layout: `modules/`, `middleware/`, `lib/`, `db/`
- [x] SQLite via better-sqlite3 with Drizzle ORM, lazy singleton connection, WAL mode
- [x] Idempotent schema bootstrap so a fresh install needs zero migration steps; drizzle-kit wired for future migrations
- [x] Structured logger: JSON lines to stdout plus persistence to a `logs` table, secret redaction by key name (unit tested)
- [x] Central error handler producing one JSON envelope: AppError codes, Zod validation details, malformed body 400, unknown failures as safe 500s
- [x] Request logging middleware, health checks demoted to debug level
- [x] CORS restricted to CLIENT_ORIGIN instead of wildcard
- [x] Module router pattern established (`GET /api/health`)
- [x] Graceful shutdown on SIGINT/SIGTERM closing server and database
- [x] ESLint for the server matching the web app conventions
- [x] Vitest integration tests: health endpoint, 404 envelope, malformed JSON, log redaction — 6 passing
- [x] `.env.example` extended with PORT, DATABASE_PATH, LOG_LEVEL, CLIENT_ORIGIN

### Verification status

Typecheck clean, lint clean, tests 6/6 passing at completion; live smoke test of health, 404, and malformed-body paths done against an ephemeral-port server.

## Phase 3, Frontend and Backend Integration, Current Phase

### Done

- [x] Typed API client (`lib/api/client.ts`): JSON envelope parsing, ApiError with status/code/details, NetworkError, 10s timeout, cookie credentials included
- [x] `useApi` hook with derived loading state, typed errors, refetch keeping previous data visible
- [x] Server session probe `GET /api/auth/me` returning `{ authenticated, authEnabled }`; reports auth disabled until Phase 4
- [x] AuthProvider context: loading → authenticated / unauthenticated / unavailable (server-decided)
- [x] ProtectedRoute guarding the app shell — redirects to /login once the server enables auth; bypasses while disabled so development stays usable. Zero frontend changes needed when Phase 4 lands
- [x] First live data in the UI: Dashboard API-status chip consuming `/api/health` through the Vite proxy
- [x] E2E verified: browser path Vite :5199 → proxy → Express → SQLite responds for health and session endpoints

### Notes

- Pages still render mock data from `lib/data/*` by design: real domain endpoints arrive with their own phases (jobs in Phase 7, proposals in Phase 9, logs in Phase 12). Each page swaps to `useApi` one file at a time from Phase 7 onward.
- Login/signup remain visual mocks until Phase 4.

## Phase 4, Authentication, Current Phase

### Done

- [x] Password hashing on node:crypto scrypt (memory-hard KDF, zero native deps), constant-time verification
- [x] Users, sessions, and backup_codes tables added to schema and idempotent bootstrap
- [x] Sessions: httpOnly cookie holding a random token, only its SHA-256 stored server-side, 30 day expiry, expired rows cleaned on read
- [x] POST /api/auth/register — first account becomes installation owner, generates 8 unambiguous one-time backup codes returned exactly once, signs the user in; further registrations refused with 409
- [x] POST /api/auth/login — identical error for unknown email vs wrong password
- [x] POST /api/auth/logout — destroys session row and clears cookie
- [x] POST /api/auth/recover — consumes one unused code, resets password, invalidates all existing sessions
- [x] GET /api/auth/me now reports authenticated state, user identity, and needsSetup for fresh installs
- [x] Zod validation on every auth body; auth events logged via the structured logger (no secrets)
- [x] Login page wired to real endpoint with inline error display and remembered destination
- [x] Recovery dialog takes code + new password and reports success
- [x] Signup page displays the real server-generated codes at step two
- [x] Sidebar/header account menu shows the signed-in user; logout hits the API and refreshes auth state so ProtectedRoute redirects
- [x] Auth test suite: registration, ownership refusal, weak-password rejection, wrong-password envelope, login/logout lifecycle, recovery incl. reuse rejection — 15 tests passing total
- [x] Full flow exercised live through the Vite proxy against a real SQLite file database

### Notes

- Login rate limiting is deliberately deferred — single-user local install; revisit as hardening later.
- Onboarding wizard remains a visual mock until Phase 5 connects credential storage to it.

## Phase 5, Platform Credentials, Current Phase

### Done

- [x] AES-256-GCM credential encryption via node:crypto, key scrypt-derived from a required ENCRYPTION_KEY env secret
- [x] platform_credentials table storing cipher text, IV, and auth tag; values never leave the server in plaintext after save
- [x] requireUser middleware guarding owner-only endpoints
- [x] POST /api/credentials/:id/test — one lightweight real API call (Freelancer.com /users/self, OpenRouter /key) without saving
- [x] PUT /api/credentials/:id — verifies against the live service BEFORE storing; failing credentials are refused
- [x] Masked previews only ("frl_••••3f9a"); GET list never returns plaintext
- [x] OpenRouter model selection persisted; live model catalogue fetched from OpenRouter
- [x] Rate-limit quota (Freelancer headers) and credit usage (OpenRouter) surfaced for display
- [x] Platforms page fully wired: real statuses, test buttons, replace dialog with inline errors, model selector, usage meters
- [x] Onboarding steps 1–2 perform real verification and encrypted saves; model catalogue loads live
- [x] dotenv now loads apps/server/.env then repo-root .env as fallback (cwd-independent)
- [x] Test suite: encryption round-trip, masking, save/refuse flows, quota parsing, auth guard — 22 tests passing

### Notes

- ENCRYPTION_KEY was generated into the user's local .env; losing it makes stored credentials unreadable by design.
- Profile import in onboarding stays mocked until Phase 6.

## Verification Log

Record of user review sessions:

| Date | Scope reviewed | Result |
| ---- | -------------- | ------ |
| —    | —              | —      |

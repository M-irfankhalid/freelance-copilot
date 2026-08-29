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

## Phase 3, Frontend and Backend Integration

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

## Phase 4, Authentication

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

## Phase 5, Platform Credentials

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
- [x] RouteErrorBoundary added as global errorElement on root and auth routes
- [x] Onboarding steps 1–2 perform real verification and encrypted saves; model catalogue loads live; step 3 performs real profile import
- [x] dotenv now loads apps/server/.env then repo-root .env as fallback (cwd-independent)
- [x] Test suite: encryption round-trip, masking, save/refuse flows, quota parsing, auth guard — 22 tests passing (28 total with profile tests)
- [x] ENCRYPTION_KEY generated into user's local .env

### Notes

- ENCRYPTION_KEY was generated into the user's local .env; losing it makes stored credentials unreadable by design.
- Profile import in onboarding stays mocked until Phase 6.

## Phase 6, Profile

### Done

- [x] user_profile table, one row per installation owner, JSON array columns for skills/experience/portfolio/filters
- [x] GET/PUT /api/profile with strict Zod validation on write and defensive parsing on read
- [x] POST /api/profile/import fetches the owner's public data from Freelancer.com using their saved token and maps it to our schema; returns a draft for review, stores nothing until PUT
- [x] Import uses correct API params: `self/?compact=false&profile_description=true&jobs=true` for profile data, then separate `portfolios/?users[]={id}` call for portfolio projects
- [x] Import tolerates partial data: missing fields stay empty rather than inventing content
- [x] Import maps real API fields only: username→freelancerUsername, display_name→name, public_name→title, hourly_rate→hourlyRate, profile_description→about, jobs[].name→skills, portfolios→portfolio array (title/url/description)
- [x] Profile page fully wired: load, edit everywhere, import button fills the form while preserving manual-only sections, save with inline errors
- [x] Onboarding step 3 performs real import with profile_description + jobs + portfolios params; Finish persists imported basics plus keyword preferences into the profile
- [x] Test suite: session guard, round-trip persistence, validation rejection with field details, import mapping incl. malformed skill entries, missing-token failure mode, portfolio import mapping — 28 tests passing
- [x] Test suite: session guard, round-trip persistence, validation rejection with field details, import mapping incl. malformed skill entries, missing-token failure mode - 28 tests passing

### Notes

- The AI may only use facts from this profile; validation is the enforcement point.
- Scan interval chosen in onboarding remains visual until the automation phase persists settings.

## Phase 7, Jobs Integration

### Done

- [x] Schema: `jobs.projectId` migrated from text to integer with a safe one-time `DROP TABLE jobs` on legacy DBs (no migration tooling yet, idempotent bootstrap re-creates the table)
- [x] `jobs.client.ts` rewritten against the real Freelancer.com API: search hits `/projects/0.1/projects/active/`, detail hits `/projects/0.1/projects/{id}`, bids live at `/projects/0.1/projects/{id}/bids/`, by-URL parsing of `/projects/{id}` segments
- [x] Real request shape: `query=` for keywords, `jobs[]=id` (numeric category ids) for skill filters, `limit`/`full_description`/`compact` flags always set; response wrapper is `result.projects[]` not a bare array
- [x] Field mapping reflects what the project endpoint actually returns: `budget.minimum`/`maximum`, inline `bid_stats`, `time_submitted` Unix seconds → server-formatted relative label, `jobs[].name` → skills, `location.country.name` → country
- [x] Skill-name → category-id table for top dev skills (React.js, Node.js, Python, Laravel, Tailwind, etc.) so the search filter has signal; unknown names fall back to keyword text
- [x] Service upserts locally on every search/detail refresh, preserving the user's analysis state (status, matchScore, analysis JSON) across re-imports
- [x] `analyzeJob` loads the saved profile via `getProfile(userId)`, builds an `AnalysisPrompt`, calls `ai.service.ts::analyzeJob`, persists a `StoredAnalysis` JSON blob, and returns the legacy `JobAnalysis` shape the UI expects
- [x] `parseInt(req.params.projectId)` replaced with a strict integer parser returning 400 on bad input; the analyze route no longer takes a body (profile is loaded server-side)
- [x] Frontend: `apps/web/src/pages/jobs/page.tsx` switched to `useApi<{ jobs: JobResponse[] }>("/api/jobs")`, with the "Scan now" button calling `POST /api/jobs/search` and the manual-add form accepting either a URL or a bare project id
- [x] Frontend: `apps/web/src/pages/jobs/[id]/page.tsx` switched to `useApi<JobDetailResponse>(`/api/jobs/${id}`)`, with Analyze / Re-analyze, Ignore, and Refresh-insights all hitting the real endpoints
- [x] Error envelopes, loading skeletons, and the existing shadcn card layout preserved (no design changes per project memory)
- [x] Test suite: stubbed `fetch` for the four real endpoints, covers auth guard, search persistence with `postedLabel` ("just now", "3h ago") and `budgetLabel` formatting, detail paragraph splitting, full analyze flow (AI stubbed, result persisted and surfaces on re-fetch), ignore, and by-URL fetch — 8 new tests, 44 passing total
- [x] Raw API response captured in `jobs.raw_data` (JSON) for debugging and future field extraction
- [x] Bid competition data fetched and stored per-project: `bids` table with bidder id/name, amount, cheapest flag, submitted timestamp, and proposal excerpt; `CompetitionSummary` (bidCount, minBid, maxBid, medianBid, isCheapest) computed and surfaced in job detail
- [x] Project context fields exposed in job detail: `projectType`, `bidPeriod`, `upgrades`, `reputationScore`, `clientInfo.hireRateLabel` sourced from the real `owner_info.reputation.entire_history` structure
- [x] Frontend job detail page displays new fields: project type badge + bid period in header, client reputation score in client info, competition summary (min/median/max bids, cheapest flag) in competitor proposals card when bid data is available
- [x] Proposal generation endpoint now accepts `projectType`, `bidPeriod`, `upgrades`, and `competition` in the request body (full use is Phase 9)

### Notes

- The project endpoint does not expose owner fields, so `clientInfo` surfaces "—" for member-since, projects posted, and hire rate rather than fabricating values
- Polling/background scan worker is still a manual "Scan now" button; the automation phase wires the interval

## Phase 8, AI Analysis and Matching

### Done

- [x] Pure, deterministic relevancy filter in `modules/ai/relevancy.ts`: hard-fail on any `notWants` substring match in title + description + skills; hard-fail if `wants` is non-empty and none match; hard-fail if `profileSkills` is non-empty and none match the job's skills or title — all case-insensitive
- [x] Filter runs **before** any OpenRouter call inside `analyzeJob`; a filtered job returns a synthetic `AnalysisResult` with `score: 0`, the filter reasons as `concerns`, and a clear "filtered" summary so the user knows no AI tokens were spent
- [x] `callOpenRouter` honors the user-selected model persisted in `platform_credentials.meta.modelId`, falling back to `openai/gpt-4o-mini` if unset; a per-request override on the service function still wins
- [x] Test suite: pure `applyRelevancyFilter` unit tests for the six happy-path / fail paths and case-insensitive matching, plus two integration tests through `POST /api/jobs/:id/analyze` — one proves OpenRouter is **not** called when not-wants matches (stub throws if the URL is hit), the other proves the real AI call path returns the score and recommended bid when the filter passes
- [x] AI output validation (`validateAnalysisOutput`) untouched: JSON must parse, verdict must be one of three values, score 0–100, summary ≥ 10 chars, at least one reason — preventing the model from being used to drive UI without a real result

### Notes

- The filter is intentionally cheap keyword-level screening; nuanced matching still lives in the AI. This keeps OpenRouter usage tied to jobs the user has a real chance of caring about
- `notWants` is the only hard block — `wants` and `profileSkills` reduce AI calls but do not silently drop jobs from the list

## Phase 9, Proposal Generation

### Done

- [x] `ProposalPromptData` interface and `buildProposalPrompt` added to `ai.service.ts`, grounded only in real profile facts, job details, and competition context (never invents facts)
- [x] `generateProposalWithAI` in `ai.service.ts` loads the profile server-side via `getProfile(userId)`, builds the prompt, calls OpenRouter, and strips code fences
- [x] `generateProposal` in `proposals.service.ts` loads the real profile server-side (never accepts profileData from the frontend), checks for existing proposals (returns 409 CONFLICT), looks up prior AI analysis from cached job data, calls `generateProposalWithAI`, and inserts a draft proposal
- [x] `regenerateProposal` in `proposals.service.ts` loads the existing proposal, looks up job context from the DB cache (handles uncached jobs gracefully), calls `generateProposalWithAI` directly (bypasses duplicate check), and updates the existing proposal in place
- [x] `POST /api/proposals/generate` accepts `description`, `jobSkills`, `projectType`, `bidPeriod`, `upgrades`, `competition` — no `profileData` travels through the frontend
- [x] `POST /api/proposals/:id/regenerate` endpoint added, accepts optional `projectType`, `bidPeriod`, `upgrades`, `competition`
- [x] `PUT /api/proposals/:id/status` Zod enum extended with `queued` status
- [x] `proposalStatusEnum` extended with `queued`; `getProposalStatusLabel` covers it
- [x] Frontend proposals page (`apps/web/src/pages/proposals/page.tsx`) wired to real API: load via `useApi`, generate/regenerate/edit/status-update via `api` client
- [x] Frontend job detail page updated to send `description`, `jobSkills`, `projectType`, `bidPeriod`, `upgrades`, `competition` to the generate endpoint (no `profileData`)
- [x] Test suite: 8 tests covering generate, list, duplicate prevention (409), status update to queued, content edit via PUT, regeneration, auth required (401), and 404 for non-existent proposal on regenerate — all 8 passing, 52/52 total

### Notes

- `generateProposalWithAI` loads the profile internally via `getProfile(userId)`; the `profile` field in `ProposalPromptData` is overridden and effectively ignored in the input
- The `competitorNote` from the AI response includes the stored bid count from the stubbed OpenRouter response

## Verification Log

Record of user review sessions:

| Date       | Scope reviewed        | Result |
| ---------- | --------------------- | ------ |
| 2026-08-27 | Phase 7 (Jobs) + Phase 8 (AI Analysis) implementation, typecheck clean, server tests 44/44 passing. |  |
| 2026-08-28 | Code hygiene pass: removed leaked OpenRouter key from launch.json, deleted debug console.logs, fixed 22 server TypeScript errors (skill shape standardized to string[], ErrorCode/LogCategory unions extended), fixed Drizzle .where() arity in proposals.service.ts, removed 3 orphaned mock data files, cleaned unused imports in ai/summary.service.ts, added lint script to server package.json, added typecheck script to web package.json, fixed root test script. Fixed title mapping in profile import (public_name, was regressed to tagline/headline), fixed mangled URL query param (sanction_details&rising_star), persisted userSummary in saveProfile. All checks pass: server tsc --noEmit clean, 44/44 tests passing, server ESLint clean, web tsc --noEmit clean, web ESLint 0 errors. |  |
| 2026-08-28 | Phase 7/8 expansion — richer job data model: raw_data column + bids table, raw API response capture, bid competition fetching/storing, project context fields (type/period/upgrades/reputation), test mock data aligned to real API shape (nested entire_history), frontend job detail page surfaces competition summary + reputation + project type + bid period. Tests 44/44, typecheck clean, lint clean. |  |
| 2026-08-28 | Codebase hygiene pass: removed leaked OpenRouter key from launch.json, deleted debug console.logs, fixed 22 server TypeScript errors (skill shape standardized to string[], ErrorCode/LogCategory unions extended), fixed Drizzle .where() arity in proposals.service.ts, removed 3 orphaned mock data files, cleaned unused imports in ai/summary.service.ts, added lint script to server package.json, added typecheck script to web package.json, fixed root test script. Fixed title mapping in profile import (public_name, was regressed to tagline/headline), fixed mangled URL query param (sanction_details&rising_star), persisted userSummary in saveProfile. All checks pass: server tsc --noEmit clean, 44/44 tests passing, server ESLint clean, web tsc --noEmit clean, web ESLint 0 errors. |  |
| 2026-08-28 | Phase 9 (Proposals) complete. Added `buildProposalPrompt`, `generateProposalWithAI`, `ProposalPromptData` to ai.service.ts; rewrote `generateProposal` to load profile server-side and check for duplicates (409); added `regenerateProposal` using `generateProposalWithAI` directly to update existing proposals in place; extended `proposalStatusEnum` with `queued`, PUT /:id/status Zod enum with `queued`, added POST /:id/regenerate endpoint, wired frontend proposals page to real API, updated job detail page to send full job context without profileData. Fixed accidental comment-out of `buildAnalysisPrompt` (unclosed JSDoc), lint error on `content` const, missing await on `getProposal` in regenerate. All checks pass: server tsc --noEmit clean, 52/52 tests passing, server ESLint clean, web tsc --noEmit clean. |  |

### Note

Phase 7 and Phase 8 were verified: `pnpm --filter server typecheck` clean, `pnpm --filter server test --no-file-parallelism` reports 44/44 passing across 7 files. The two integration tests added for Phase 8 (relevancy filter short-circuits the AI; real AI call path returns score + bid) assert via a fetch stub that throws if `openrouter.ai` is hit when it shouldn't be. Pre-existing web typecheck errors in `apps/web/src/App.tsx` and `apps/web/src/components/shared/error-boundary.tsx` are unrelated to Phase 7/8.

Phase 9 is verified: server typecheck clean, 52/52 tests passing (8 new proposal tests, 44 from Phases 7/8 carried forward), server ESLint clean, web typecheck clean.

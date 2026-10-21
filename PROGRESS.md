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
- [x] Profile: import banner, basics, skills as search keywords, wants and not-wants filters, user summary, portfolio summary, custom AI instructions
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

- [x] user_profile table, one row per installation owner, JSON array columns for skills/filters plus narrative summary fields
- [x] GET/PUT /api/profile with strict Zod validation on write and defensive parsing on read
- [x] POST /api/profile/import fetches the owner's public data from Freelancer.com using their saved token and maps it to our schema; returns a draft for review, stores nothing until PUT
- [x] Import uses correct API params: `self/?compact=false&profile_description=true&jobs=true` for profile data and skills
- [x] Import tolerates partial data: missing fields stay empty rather than inventing content
- [x] Import maps real API fields only: username→freelancerUsername, display_name→name, public_name→title, hourly_rate→hourlyRate, profile_description→about, jobs[].name→skills
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
- [x] Optional **Jev** relevance-gate engine (`modules/ai/jev.service.ts`): the gate can run on TypeSafe's Jev decision model through OpenRouter's separate Decisions endpoint (`/api/alpha/decisions`, default `typesafe/jev-1.13`) instead of a chat model — same BYOC key, no new credential or provider. Jev returns typed answers only, so the gate asks a `score` question plus a `choice` over a fixed factor vocabulary (`good_fit`, `skill_gap`, `budget_below_rate`, `client_untrusted`, `too_many_bids`, `needs_signature`, `unclear_scope`) and the one-sentence reason is rendered in code from the chosen factor. The `score` question carries the ordered `criteria` level array the API requires (six evenly spaced levels), and Jev answers with a POSITION on that scale (0–5), converted to 0–100 by `scoreFromLevelIndex` so index 4 stays aligned with `minMatchScore`'s 80 and index 3 with the manual-review band. Everything numeric is pre-resolved into labels in the state (bid-volume band, `requires_signature`, verification labels, account-age/reputation labels) because Jev is weak on raw numbers. Any Jev failure — alpha endpoint down, bad model id, unrenderable answer — is logged and raised, never quietly re-screened by the relevance model: the engine in use must always match the engine configured, and a silent downgrade is what let a broken Jev setup look healthy. The relevance-model control is disabled on the Platforms page while Jev is selected. Engine and Jev model id persist in `platform_credentials.meta` (`analysisEngine`, `jevModelId`), defaulting to `llm` so pre-Jev installs are unchanged. Platforms page gained an engine selector, a Jev model field and a **Test Jev** action (separate from the key test on purpose — saving a key must not depend on the alpha endpoint); the probe sends the gate's own `score` question so a rejected shape fails the test rather than hiding behind it.

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

## Post-Phase 9 maintenance pass

### Done

- [x] **Automation toggle bug**: the debounced settings save in the automation page closed over a stale `settings` value, silently reverting every toggle ~750ms after switching it on. Fixed by keeping a ref pointing at the latest merged settings and building the PUT body from it.
- [x] **Worker never resumes after hitting the daily bid cap**: `runAutoBidCheck` set `paused: true` at the cap and `checkAndResetDailyCap` never cleared it, permanently killing fetch/analyze/draft. The cap now gates bidding only — scanning/analyzing/drafting keep running, and bidding resumes next day when `bidsToday` resets.
- [x] **Ignore countries**: new `ignored_countries` column on `user_profile` (idempotent ALTER backfill), `ignoredCountries` in the profile schema/service/import, pure `isCountryIgnored` matcher in `ai/relevancy.ts` (name or ISO code, case-insensitive, partial containment). Jobs from ignored countries are stored with status `ignored` during search ingest (never AI-analyzed) and `analyzeJob` short-circuits to a score-0 result as defense in depth. Profile page has an "Ignored countries" chip editor in Relevancy filters.
- [x] **Mock data fully removed**: all remaining frontend mock data (`lib/data/{user,dashboard,matches,logs,proposals,bids,platforms}.ts`) deleted. Dashboard, Matches, Settings account fields, and the sidebar user menu now render real API/session data.
- [x] **New dashboard endpoint**: `modules/dashboard/` with `GET /api/dashboard` aggregating KPIs (jobs found / strong matches / pending proposals / submitted bids with signed deltas), match-quality snapshot, jobs requiring attention, recent proposals, recent bids, bid win rate, platform connection status (from credential state + sync/ai logs), and a log-derived activity feed.
- [x] **Matches endpoint**: `listMatches(userId)` in `jobs.service.ts` + `GET /api/jobs/matches` registered before `/:projectId`; computes matched/missing skills against the profile and returns stored concerns/summary per analyzed job.
- [x] **Web lint fixes**: re-enabled the bid-insights card on job detail (restored `RefreshCw`/`refreshInsights`), removed the commented duplicate Analyze button, reformatted the "Show on Freelancer" link, removed a debug `console.log`, dropped an unused `ProposalActionResponse`, and replaced the proposals page's setState-in-effect with a `useMemo` derivation backed by `refetch()` after mutations.
- [x] **Hygiene**: `.ua/`, `*.db-shm`, `*.db-wal` added to root `.gitignore`.

### Verification status

Verification is run after this entry: server + web typecheck, server tests, and both lints (see Verification Log).

## Two-model pipeline & score-gated auto-bidding

### Done

- [x] **Two-model architecture**: Model A (cheap/fast) is a relevance gate — input is job title + description + user summary + relevancy instructions, output is `{ relevant, score, reasons, summary }`; the score becomes the job's match score. Model B (strong) writes proposals and only runs on relevant jobs. The legacy deep-analysis call was replaced by the relevance gate (kept as a manual endpoint).
- [x] **One auto threshold**: `minMatchScore` gates auto-bidding, and since a proposal is only auto-written for a job the pipeline is about to bid on, it gates auto-proposals too. The separate `proposalThreshold` and the `autoDraft` toggle were removed.
- [x] **Auto-proposals coupled to auto-bid**: auto-bid ON and score ≥ minMatchScore → the pipeline auto-writes the proposal, auto-approves it, and places the bid in the same run. Auto-bid OFF → no proposals are auto-written; the user reviews matches and generates + places bids manually.
- [x] **Bid fields**: amount = the project's minimum budget (`project.budget.minimum`; hourly projects use their hourly minimum), clamped within the user's min/max safety bounds; period default changed 7 → 1 day; milestone 50%. Auto-bid skips jobs with no budget minimum.
- [x] **Ignored-country jobs**: during search ingest they are stored as a minimal marker row (status `ignored`, no `rawData`) and never analyzed/drafted/bid; existing rows are re-marked ignored and their `rawData` dropped.
- [x] **Profile additions**: `relevancyInstructions` (free-text steering for Model A), `portfolioSummary` (single markdown box), `proposalTemplates` (one long markdown containing all templates), and an editable `userSummary`. Proposal generation now sends user summary + custom instructions + portfolio summary + all templates + job detail to Model B.
- [x] **Two-model selection**: saved in platform credentials (OpenRouter catalogue only), with backward-compatible fallback to the legacy single `modelId`.
- [x] Test suite: 99 tests passing (new pipeline test proves a fresh job is analyzed → drafted → auto-approved → auto-bid in one run, with the amount derived from the project budget). Server + web typecheck clean.

## Automation robustness fixes

- [x] **Single-flight pipeline**: a manual "Run pipeline now" can no longer overlap a scheduled tick. Two overlapping runs both passed the proposal-existence check before the slow AI call, then the second insert tripped the `proposals (user_id, job_id)` UNIQUE constraint (`UNIQUE constraint failed: proposals.user_id, proposals.job_id`). `runPipeline` now guards with an in-process lock; a concurrent run returns "skipped" and logs it.
- [x] **Clean conflict instead of 500**: `generateProposal`/`createProposal` translate a DB UNIQUE violation into a 409 CONFLICT ("proposal already exists"). The pipeline draft loop treats 409 as a skip ("proposal already exists — skipped") rather than logging an error.
- [x] **Timeout handling**: proposal generation budget raised 120s → 180s; a timed-out OpenRouter call surfaces a clear 504 `UPSTREAM_TIMEOUT` message (adds the code to `ErrorCode`) instead of the raw "The operation was aborted due to timeout".
- [x] Verified: server typecheck clean, 99/99 tests passing, server ESLint clean.

## Auto-proposals only when auto-bid is on

- [x] **Rule**: the pipeline writes a proposal solely so it can bid on that job. Auto-proposal generation is gated on `autobidEnabled` + `minMatchScore`; with auto-bid off, no proposals are auto-written (the user reviews matches and generates + places bids manually).
- [x] Removed the now-dead `autoDraft` toggle and `proposalThreshold` field from the automation settings (interface, defaults, insert, route Zod schema, web types, and the automation page UI — the "Automatic proposals" toggle and "Proposal threshold" input are gone; the auto-bid card now says it also writes the proposal). DB columns are left in place (no migration needed).
- [x] The pipeline draft step auto-approves unconditionally (it only runs when auto-bid is on), so Step 9 always finds a bid-ready proposal.
- [x] Pipeline tests restructured: auto-bid off → analyze but draft 0; auto-bid on → draft + auto-approve + bid. Verified: server tsc clean, 99/99 tests, server ESLint clean, web tsc clean, web ESLint clean.

## Rejection reasons, bid-failure tracking, and Discord notifications

- [x] **Rejection reasons**: `jobs` gained `rejection_reason` (idempotent ALTER backfill + CREATE TABLE literal so fresh DBs get it too). Every reject path now records why — ignore-list country exclusion (search ingest + `analyzeJob` defense-in-depth), the deterministic keyword filter (`Filtered out by your profile filters: …`), the relevance-model gate (`Marked irrelevant by the relevance model: …`), and manual ignore (`Marked ignored by you.`). Surfaced via `listStoredJobs` and `getJobById` (`JobDetailData.rejectionReason`); the web job-detail page shows an amber "Why this job was rejected" banner for ignored jobs.
- [x] **Bid-failure tracking**: `jobs` gained `auto_bid_failed_at` + `auto_bid_error`. When an auto-bid attempt throws, `runAutoBidCheck` marks the job so the engine never retries it — both the Step 7 draft query and the bid candidate query now require `auto_bid_failed_at IS NULL` — logs the run as an error, and surfaces it in `GET /api/jobs/matches` as `bidFailed: true` + `bidError`. The web matches page shows a destructive "Bid failed" badge and a warning strip so the user handles the job manually.
- [x] **Discord notifications**: new `discord_settings` table + `modules/discord/` (service + routes under `/api/discord`). Webhook URL encrypted at rest (AES-256-GCM), never returned to the frontend — only a masked preview. Four event toggles: `match`, `bid_placed`, `bid_failed`, `api_error`. The pipeline fires events (best-effort; webhook failures are swallowed so a dead webhook never breaks the pipeline) when a new job clears the match threshold, an auto-bid is placed, an auto-bid fails, or an API issue occurs. Settings page gained a Discord card (webhook save, masked preview, event switches, send-test, remove webhook). Event toggles persist independently of the webhook.
- [x] Test suite: 110 tests passing — 2 new pipeline tests (a failed auto-bid is marked, never retried, and visible in matches; a keyword-filtered job carries its rejection reason through to job detail) and 9 new discord tests (unconfigured default, webhook/event validation, encrypted masked preview, event toggles honored, webhook failure swallowed, test message via API, webhook removal keeps toggles).

## Update bid — revise a submitted bid from the job page

- [x] **Bid id is now stored**: `user_bids` gained a nullable `freelancer_bid_id` (schema + idempotent `ALTER TABLE` backfill + the `CREATE TABLE` literal, so fresh DBs get it too). `placeBid` and the auto-bid path now keep the response from `POST /bids` instead of discarding it and read the platform id via `readBidId` (accepts a nested `result.bid_id`, a flat `bid_id`, or `result.id` — the live shape is unverified); a bid placed without one logs a warning rather than failing silently. Returned by `listBids`/`getBid` and by `GET /api/jobs/:projectId` as `myBid`.
- [x] **`Update bid` button** next to `Place bid` on the job detail page, always enabled — it is the user's choice, and the case it exists for is a bid this app never placed. Opens a dialog with Bid ID, amount, milestone % and description, prefilled from the stored bid when there is one and otherwise from the page's own fields.
- [x] **Manual id entry plus a user-clicked `Find`**: Find calls `GET /api/bids/project/:projectId/find`, which resolves the bidder id from the cached credential meta (no repeat `/self`) and filters the project's bids to the user's own; it fills the id and only fills amount/description where those fields are still blank. Nothing is fetched when the dialog opens or the page loads — no extra API calls behind the user's back.
- [x] **`PUT /api/bids/project/:projectId`** → `reviseBid`, which sends `PUT /bids/{bid_id}/` upstream **first** (a rejection cannot leave a local record claiming success), then updates the newest local bid for that project — or inserts one when the app never placed it, so an outside bid appears on the Bids page and its id is remembered next time. The linked proposal is re-saved best-effort so the proposal box and the stored bid do not drift apart.
- [x] **Field translation**: Freelancer's update endpoint takes snake_case `milestone_percentage` while our API takes `milestonePercentage`; the request body carries only the three editable fields (the endpoint accepts no period). A wrong bid id is the likeliest failure, so a non-OK response surfaces Freelancer's own message rather than a bare status.
- [x] **Frontend**: new `components/jobs/update-bid-dialog.tsx` (existing Dialog/Button/Input/Label/Textarea only). The form lives in an inner component that unmounts with the dialog, so its fields reseed from the current bid on every open — the previous `useEffect` reset tripped the repo's `react-hooks/set-state-in-effect` rule and is gone.
- [x] **Caveat, recorded rather than papered over**: for a bid the app did not place, `submittedAt` is when it was first recorded here, so the Bids page "Submitted" column reads as recent. `via` stays `"manual"`, which is accurate — it records who placed the bid, and the user placed this one.
- [x] Tests: 8 new in `tests/bids.test.ts` (id captured from the place-bid response and returned by the list; the update goes to `.../bids/999999/` as a PUT with `milestone_percentage` and no camelCase key; local row + linked proposal updated with no lookup made; an untracked bid is recorded; a 404 from Freelancer surfaces as `NOT_FOUND` with the upstream message and saves nothing; an out-of-range milestone is rejected before any call; `find` returns the user's bid and `null` when the project has none; auth required on both routes). The stub also gained a project-detail branch, because `getJobById` re-reads the project from Freelancer rather than trusting the stored copy.

## Delivery timeline for bids (AI-chosen, editable)

- [x] **Shared constants + setting read** (`apps/server/src/lib/delivery-timeline.ts`, new): `MIN/MAX_DELIVERY_DAYS`, `DEFAULT_PREFERRED_DELIVERY_DAYS` (4 — the number auto-bid hardcoded before the feature), `DEFAULT_DELIVERY_TIMELINE_OPTIONS` ([1, 3, 5, 7, 10]), prefilled default instructions. `getDeliveryTimelineSettings(userId)` is a pure DB read mirroring `getPreanalysisGates`, and `resolveDeliveryDays` is a pure function so it is unit-testable. Lives in `lib` so `ai`/`jobs`/`platforms`/`automation` can all import it without closing an import cycle.
- [x] **Schema + bootstrap** (`db/schema.ts`, `db/index.ts`): `jobs.delivery_days` INTEGER (nullable) and `automation_settings` gained `ai_delivery_timeline`, `preferred_delivery_days`, `delivery_timeline_options` (TEXT, JSON), `delivery_timeline_instructions` (TEXT) — both added as ALTER TABLE backfills and to the CREATE TABLE literals, copying the `proposal_threshold` template. No migration folder: the hand-written idempotent `ensureSchema()` is the sole source of truth.
- [x] **Settings plumbing** (`automation.service.ts`): `AutomationSettings` / `rowToSettings` / `getOrCreateSettings` / `saveSettings` carry the four fields. `saveSettings`'s generic loop special-cases `deliveryTimelineOptions` to JSON-stringify + sanitize (the one array-valued setting, living in a TEXT column). `runAutoBidCheck` deleted `DEFAULT_BID_PERIOD` and reads `resolveDeliveryDays(settings, job.deliveryDays)` for both the `placeBid` call and the `user_bids` insert; the "Auto-bid placed" run log line now shows the chosen days.
- [x] **Route validation** (`automation.routes.ts`): the four fields are on the PUT Zod schema, all `.optional()` like their neighbours, with `deliveryTimelineOptions` requiring at least one value so a broken list can never round-trip.
- [x] **Relevance gate picks the timeline**: `ai.service.ts` `buildRelevancyResponseFormat(options)` is byte-identical to the old shared const when off, and adds `deliveryDays` with `enum: options` + `required` when on; `validateRelevancyOutput(rawText, options?)` returns `{score, reason}` without the key when off (so `ai.test.ts`'s exact `toEqual` assertions stay green) and adds `deliveryDays` (integer, or null if not on the list) when on — never throws for a bad pick; `buildRelevancyPrompt` appends a `bidPeriod` line and a timeline block with the user's instructions, and the JSON format line conditionally adds `"deliveryDays"`. `jev.service.ts` adds a `delivery_period` `choice` question (keys are the day values) via `buildDeliveryPeriodQuestion`/`buildJevGateQuestions`, reads it back mirroring `deciding_factor`, and `validateJevGateOutput` nulls any answer not on the list — the question is omitted entirely when the option list is empty.
- [x] **Jev probe** (`platforms/testers.ts`, `credentials.service.ts`): `testJevEngine(userId)` now reads `getDeliveryTimelineSettings(userId)` and passes a `DeliveryTimelineRequest` into `testJevAccess`, which calls `buildJevGateQuestions(timeline)` instead of inlining `{ score: JEV_SCORE_QUESTION }`. `Test Jev` so exercises the exact question set the gate sends, including the `delivery_period` question — the shape-checking that exists to catch the recorded bug where a rejected shape 400'd every screening call while the probe reported success. (The route already passed `req.user!.id`; only the service signature now uses it.)
- [x] **Persist per job** (`jobs.service.ts`): `analyzeJob` reads `getDeliveryTimelineSettings(userId)`, passes the timeline options/instructions + `bidPeriod` into `checkRelevancyWithAI`, and writes `deliveryDays: check.deliveryDays ?? null` on BOTH the insert and update paths. `getJobById` passes `deliveryDays` through `extras` to `mapToJobDetail`.
- [x] **Surface on job detail** (`jobs.client.ts`): `mapToJobDetail`'s `storedState` extras type and the returned `JobDetailData` object carry `deliveryDays`; `JobDetailData.deliveryDays` (beside `bidPeriod`) added in `jobs.client.ts` and `apps/web/src/lib/types.ts`.
- [x] **Automation page** (`apps/web/src/pages/automation/page.tsx`): new "Delivery timeline" card after Auto-bid — `Switch` for AI selection, a number input for the preferred days, a comma-separated text input for allowed times (held as raw text, committed only once it parses to at least one valid value so mid-typing states never round-trip a broken list), and a `Textarea` for editable instructions. `BackendSettings`/`normalizeSettings`/PUT body extended with the four fields.
- [x] **Manual bid page** (`apps/web/src/pages/jobs/[id]/page.tsx`): replaced the dead `deliveryTime` string state with a real number input prefilled from `job.deliveryDays ?? job.bidPeriod ?? 7`, sent as `period` in `placeBid`; labelled as the AI's suggestion when the job carries a pick so the freelancer sees where the number came from and can override it.
- [x] **Tests**: 31 new — `delivery-timeline.test.ts` (unit tests for `sanitizeDeliveryDaysList`/`resolveDeliveryDays`), `ai.test.ts` (delivery timeline question present/absent in the schema, valid in-list value returned, out-of-list/missing/non-integer → null, score never lost, `readDeliveryDays` tolerance), `jev.test.ts` (question present only when enabled, answer read + validated, out-of-list → null, empty list → no question, existing shape-unchanged when off, **and** a live-shape Test Jev probe that asserts `delivery_period` reaches the Decisions API), `automation.test.ts` (defaults 210-220 now assert the four fields; PUT round-trip 235-258 extended with dedupe/sort/survive-reread plus an empty-list 400; later describes reset the timeline), `pipeline.test.ts` (stub returns `deliveryDays`; existing autobid test asserts `period: 4` while AI selection is off; new test turns AI selection on, asserts the gate's pick reaches both the `POST /bids` payload and the `jobs`/`user_bids` rows).
- [x] Verified: server `pnpm --filter server typecheck` clean, `pnpm --filter server lint` clean, `pnpm --filter server test` — 220/220 (18 files). Web `pnpm --filter web typecheck` clean, `pnpm --filter web lint` clean on every touched file. `pnpm --filter web build` fails only on pre-existing errors in `apps/web/src/App.tsx`, `components/shared/error-boundary.tsx` and `lib/api/hooks.ts` (react-router v7 / React 19 / TS 6 type drift) — none in the delivery-timeline files.

**Remaining verification (live)**: with AI timeline selection on, re-analyse a job in the running app and confirm `delivery_days` is set on the job row and `period` reaches `POST /bids`; press **Test Jev** with the switch on and confirm the probe sends `delivery_period`; confirm the manual bid form prefills the AI's suggestion.

## Verification Log

Record of user review sessions:

| Date       | Scope reviewed        | Result |
| ---------- | --------------------- | ------ |
| 2026-08-27 | Phase 7 (Jobs) + Phase 8 (AI Analysis) implementation, typecheck clean, server tests 44/44 passing. |  |
| 2026-08-28 | Code hygiene pass: removed leaked OpenRouter key from launch.json, deleted debug console.logs, fixed 22 server TypeScript errors (skill shape standardized to string[], ErrorCode/LogCategory unions extended), fixed Drizzle .where() arity in proposals.service.ts, removed 3 orphaned mock data files, cleaned unused imports in ai/summary.service.ts, added lint script to server package.json, added typecheck script to web package.json, fixed root test script. Fixed title mapping in profile import (public_name, was regressed to tagline/headline), fixed mangled URL query param (sanction_details&rising_star), persisted userSummary in saveProfile. All checks pass: server tsc --noEmit clean, 44/44 tests passing, server ESLint clean, web tsc --noEmit clean, web ESLint 0 errors. |  |
| 2026-08-28 | Phase 7/8 expansion — richer job data model: raw_data column + bids table, raw API response capture, bid competition fetching/storing, project context fields (type/period/upgrades/reputation), test mock data aligned to real API shape (nested entire_history), frontend job detail page surfaces competition summary + reputation + project type + bid period. Tests 44/44, typecheck clean, lint clean. |  |
| 2026-08-28 | Codebase hygiene pass: removed leaked OpenRouter key from launch.json, deleted debug console.logs, fixed 22 server TypeScript errors (skill shape standardized to string[], ErrorCode/LogCategory unions extended), fixed Drizzle .where() arity in proposals.service.ts, removed 3 orphaned mock data files, cleaned unused imports in ai/summary.service.ts, added lint script to server package.json, added typecheck script to web package.json, fixed root test script. Fixed title mapping in profile import (public_name, was regressed to tagline/headline), fixed mangled URL query param (sanction_details&rising_star), persisted userSummary in saveProfile. All checks pass: server tsc --noEmit clean, 44/44 tests passing, server ESLint clean, web tsc --noEmit clean, web ESLint 0 errors. |  |
| 2026-08-28 | Phase 9 (Proposals) complete. Added `buildProposalPrompt`, `generateProposalWithAI`, `ProposalPromptData` to ai.service.ts; rewrote `generateProposal` to load profile server-side and check for duplicates (409); added `regenerateProposal` using `generateProposalWithAI` directly to update existing proposals in place; extended `proposalStatusEnum` with `queued`, PUT /:id/status Zod enum with `queued`, added POST /:id/regenerate endpoint, wired frontend proposals page to real API, updated job detail page to send full job context without profileData. Fixed accidental comment-out of `buildAnalysisPrompt` (unclosed JSDoc), lint error on `content` const, missing await on `getProposal` in regenerate. All checks pass: server tsc --noEmit clean, 52/52 tests passing, server ESLint clean, web tsc --noEmit clean. |  |
| 2026-09-01 | Two-model pipeline + score-gated auto-bidding complete. Model A relevance gate (cheap/fast, `{relevant, score, reasons, summary}`) replaces the deep analysis call during polling; Model B writes proposals. Two thresholds (`proposalThreshold` auto-write/save, `minMatchScore` auto-bid) configurable in the automation UI. Auto-bid amount = project minimum budget (hourly min for hourly), period 1 day, milestone 50%, skip when no budget. Drafts clearing `minMatchScore` with auto-bid on are auto-approved and bid in the same run. Ignored-country jobs stored as minimal markers with no `rawData`. Profile gained `relevancyInstructions`, `portfolioSummary`, `proposalTemplates`, editable `userSummary`; Model B receives full context incl. portfolio summary + all templates. Two-model selection from OpenRouter with legacy `modelId` fallback. All checks pass: server tsc --noEmit clean, 99/99 tests passing, web tsc --noEmit clean. |  |
| 2026-09-01 | Automation robustness: fixed `UNIQUE constraint failed: proposals.user_id, proposals.job_id` from overlapping pipeline runs (manual vs scheduled) by adding a single-flight guard to `runPipeline`; DB UNIQUE violations now map to clean 409 CONFLICT and the draft loop skips them instead of erroring. Raised proposal generation timeout 120s → 180s and surfaced timeouts as a clear 504 `UPSTREAM_TIMEOUT`. Verified: server tsc clean, 99/99 tests, server ESLint clean. |
| 2026-09-01 | Auto-proposals coupled to auto-bid: a proposal is now auto-written only for a job the pipeline is about to bid on (auto-bid ON + score ≥ `minMatchScore`); auto-bid OFF → no auto proposals, user writes and bids manually. Removed the dead `autoDraft` toggle and `proposalThreshold` (service, routes, web types, automation page UI); draft step auto-approves unconditionally; pipeline tests restructured to assert the new rule. Verified: server tsc clean, 99/99 tests, server ESLint clean, web tsc clean, web ESLint clean. |
| 2026-09-01 | Rejection reasons + bid-failure tracking + Discord notifications. `jobs` gained `rejection_reason`, `auto_bid_failed_at`, `auto_bid_error`; every reject path (ignore list, keyword filter, relevance gate, manual ignore) stores why, surfaced on jobs list + job detail (amber banner). Failed auto-bids are marked, never retried (draft + bid queries exclude them), and flagged `bidFailed` in matches. New `discord_settings` table + `/api/discord` routes: webhook encrypted at rest, masked preview only, 4 event toggles, test message; pipeline fires match/bid_placed/bid_failed/api_error events best-effort. Settings page has a Discord card. Fixed two real bugs found by tests: 204 `Response` constructor (empty-string body throws) and `getDiscordSettings` hiding event toggles when the webhook is absent. Verified: server tsc clean, 110/110 tests (14 files), server ESLint clean, web tsc clean, web ESLint clean. |  |
| 2026-09-02 | Per-project pipeline audit logging + test fix. Every project a scan touches is now logged to the `logs` table (Logs page): a batch line "Found N project(s) on Freelancer.com" plus one line per project with project id, title, and disposition — `PASSED`/`IGNORED` with the reason (ignore-list country, profile keyword filter, relevance model) from `searchJobs` (ingest) and `analyzeJob` (final gate outcome; refreshed/already-stored rows are logged too). Fixed the 110th test: profile import `title` mapping restored to `public_name` (an uncommitted change to `r.title` broke the fixture; PROGRESS records `public_name` as the verified API field). Verified: server tsc clean, 110/110 tests (14 files), server ESLint clean. |  |
| 2026-09-24 | Jev decision model as an optional relevance-gate engine. New `modules/ai/jev.service.ts` carries the Decisions-API transport (`POST /api/alpha/decisions`) plus state building, a two-question request (`score` + `deciding_factor` choice), strict answer validation, and the factor→sentence map; `checkRelevancyWithAI` dispatches to it when the engine is `jev` and uses it as the ONLY engine in that mode — a Jev failure is logged and raised, never re-screened by the chat model (one call, not a retry loop). `jobs.service.ts` needed no edits — the gate's entry point and `{score, reason}` shape are unchanged, so `matchScore`, the ignore floor and auto-bid gating are untouched. Settings persist in the existing `platform_credentials.meta` JSON (`analysisEngine`, `jevModelId`) with **no migration**. Also fixed: `saveCredential` preserved only `modelId` when a key was replaced, silently dropping `analysisModelId`/`proposalModelId`; it now keeps every saved setting and resets only test metadata. **Verified after the corrections**: server tsc clean, 183/183 tests (17 files), server ESLint clean, web tsc clean, web ESLint clean, web build clean. **Live-API verification found two real defects, both now fixed.** (1) The Decisions API REJECTS a `score` question with no ordered `criteria` array — the first cut omitted it, so every screening call returned a 400 naming `["questions","score","criteria"]`, and the then-present fallback quietly screened those jobs on the chat model: a Jev-enabled install was in fact running on the relevance model for every job. (2) Once accepted, a `score` answer is a POSITION on the level scale (0–5 for six levels), **not** a 0–100 number — read as a score, a perfect job would have been filed at about 5/100, under the ignore floor. The gate now sends the six-level `criteria` array and converts the position through `scoreFromLevelIndex`; the chat-model fallback was REMOVED in Jev mode (a failure is logged and raised), the relevance-model control is disabled on the Platforms page while Jev is selected, and **Test Jev** now sends the gate's own `score` question so a rejected shape fails the test instead of hiding behind it (a `noul` probe passed while every real screening call was 400ing). Cause read from this installation's own `logs` table. The caveat this replaced, kept for the record: the exact request shape for a `score` question and whether `typesafe/jev-1.13` responds with the assumed answer shape — needs one real `Test Jev` call before relying on it for auto-bid. |  |
| 2026-09-24 | Update bid — revise a submitted bid from the job page. The app never stored Freelancer's own bid id (`placeBid` discarded the response), so `user_bids.freelancer_bid_id` is now captured on placement and on auto-bid, plus a nullable-column backfill; `GET /api/jobs/:projectId` returns it as `myBid`. New `PUT /api/bids/project/:projectId` sends `PUT /bids/{bid_id}/` upstream **before** any local write and updates the newest local bid — or records one for a bid the app never placed; `GET /api/bids/project/:projectId/find` looks the id up only when the user presses Find. New dialog on the job detail page (button beside Place bid, always enabled); fields reseed on each open via a remounting inner form rather than a setState effect. Verified: server tsc clean, 191/191 tests (17 files), server ESLint clean, web tsc clean, web ESLint clean, web build clean. **Not yet verified against the live API**: whether the place-bid response really carries the bid id in one of the shapes `readBidId` accepts, and that a real update lands on Freelancer — needs one bid placed and edited from this installation. |  |
| 2026-10-21 | AI settings, verified profile brief, bid-amount refinements, and web build restoration. New `ai_settings` table + service/routes/page; saved tuning now drives screening, analysis, proposal repair, score bands, and the ignore floor. Deterministic `buildProfileBrief` grounds every AI path. Fixed-price rounding is nearest-step and never below the project minimum, with bounds applied after rounding; default fractions are 1/4, 1/3, 1/2, 2/3, full. `RouteErrorBoundary` and the sentinel ref were fixed so the production web build passes. Verified: server typecheck + ESLint clean, 663/663 tests across 44 files, web typecheck + ESLint clean, `vite build` succeeds. |  |

### Note

Phase 7 and Phase 8 were verified: `pnpm --filter server typecheck` clean, `pnpm --filter server test --no-file-parallelism` reports 44/44 passing across 7 files. The two integration tests added for Phase 8 (relevancy filter short-circuits the AI; real AI call path returns score + bid) assert via a fetch stub that throws if `openrouter.ai` is hit when it shouldn't be. Pre-existing web typecheck errors in `apps/web/src/App.tsx` and `apps/web/src/components/shared/error-boundary.tsx` are unrelated to Phase 7/8.

Phase 9 is verified: server typecheck clean, 52/52 tests passing (8 new proposal tests, 44 from Phases 7/8 carried forward), server ESLint clean, web typecheck clean.

## Bid amount configuration: default markup, fractions, and rounding

- [x] **Shared bid-amount library** (`apps/server/src/lib/delivery-timeline.ts`, new): `DEFAULT_BID_AMOUNT_FRACTIONS` (`["1/4", "0.5", "0.8", "2", "full"]`), `DEFAULT_BID_AMOUNT_INSTRUCTIONS`, `DEFAULT_BID_AMOUNT_MARKUP_PCT` (0), `DEFAULT_BID_AMOUNT_MARKUP_INSTRUCTIONS`, `DEFAULT_BID_AMOUNT_ROUND_UP_TO` (0), `DEFAULT_BID_AMOUNT_SETTINGS`. Pure functions: `sanitizeBidAmountFractions` (keeps valid `"X/Y"`/`"full"`/decimal/integer forms, de-dups case-insensitively, falls back to default), `parseBidAmountFraction`, `resolveBidAmountOptions` (concrete dollar values from fractions + optional client-mentioned budget appended as an explicit option), `extractClientMentionedBudget` (regex scan for `$N`/`N USD`/`N dollars` within the project range), `roundUpToStep(value, step)` (nearest multiple via `Math.round(value/step)*step`; 0/1 = no-op), `resolveDefaultBidAmount(min, max, markupPct)` (`min + max*pct/100`, clamped markup, rounded), `resolveBidAmount(settings, jobBidAmount, minBudget, maxBudget, projectType)` (AI pick clamped to min-budget when AI is on; markup fallback when off; `roundBidUpTo` on fixed-price projects only), `getBidAmountSettings(userId)` (pure DB read with null→default fallbacks). `BidAmountSettings` interface and `AutomationSettingsShape` carry all fields.
- [x] **Schema + bootstrap** (`db/schema.ts`, `db/index.ts`): `automation_settings` gained `default_bid_markup_pct` (INTEGER NOT NULL DEFAULT 0), `bid_amount_markup_instructions` (TEXT), `round_bid_up_to` (INTEGER NOT NULL DEFAULT 0) — via ALTER TABLE backfill and CREATE TABLE literal. `jobs.bid_amount` (INTEGER nullable) already present from earlier.
- [x] **Automation service** (`automation.service.ts`): `AutomationSettings` / `rowToSettings` / `getOrCreateSettings` / `saveSettings` carry all new fields; `runAutoBidCheck` destructures `budgetMaximum` from `parseJobRawData` and passes it to `resolveBidAmount` with `parsedJob.projectType` so rounding applies to fixed-price projects; the "Auto-bid placed" log line shows the final amount incl. rounding.
- [x] **Route validation** (`automation.routes.ts`): PUT Zod schema adds `defaultBidMarkupPct` (0–100), `bidAmountMarkupInstructions` (≤2000), `roundBidUpTo` (0–1000), all optional.
- [x] **Relevance gate** (`ai.service.ts`): `buildRelevancyPrompt` appends a `BID AMOUNT` block with the options when the user has AI bid-amount selection on AND the project has a usable max budget; the JSON format line conditionally includes `"bidAmount"`; `validateRelevancyOutput` returns the pick as an integer or null (never throws for a bad/unlisted pick). `jev.service.ts` adds a `bid_amount` choice question mirroring `delivery_period`, validated out-of-list → null, omitted when empty.
- [x] **Jev probe** (`testers.ts`, `credentials.service.ts`): `testJevAccess` now passes the full `DeliveryTimelineRequest` (which includes `bidAmount` when enabled) so `Test Jev` exercises the exact question set the gate sends, including `bid_amount` and `delivery_period`.
- [x] **Persist per job** (`jobs.service.ts`): `analyzeJob` reads `getBidAmountSettings`, resolves `resolveBidAmountOptions(fractions, budgetMaximum, clientMentionedBudget)` and passes `{options, instructions}` into `checkRelevancyWithAI`; the gate's pick is written to `jobs.bid_amount` on both insert and update. `getJobById` surfaces `bidAmount` via `mapToJobDetail`.
- [x] **Surface on job detail** (`jobs.client.ts`, `types.ts`): `JobDetailData.bidAmount` (gate's pick) and `suggestedBidAmount` (default-markup amount) carried in the extras type and returned to the frontend.
- [x] **Frontend types** (`types.ts`): `AutomationSettings` has `defaultBidMarkupPct`, `bidAmountMarkupInstructions`, `roundBidUpTo`; `BidAmountSettingsSummary` + `DashboardSnapshot.bidAmount` added; `JobDetailData` carries `bidAmount` and `suggestedBidAmount`.
- [x] **Automation page** (`pages/automation/page.tsx`): the bid-amount card toggles AI selection; when ON shows fractions + instructions; when OFF shows the markup % input + markup instructions. The **Round bid to nearest** input is shown **in both states** (moved outside the if/else) so users with AI selection on can still enable rounding for the gate's picks. `BackendSettings`/`normalizeSettings`/PUT body carry all fields.
- [x] **Dashboard card** (`components/dashboard/bid-amount-settings-card.tsx`): read-only summary card with mode badge (AI selection vs default markup), fractions or "min + X% of max" row, min/max bounds, and a Rounding row — placed in the dashboard grid next to `MatchQualityCard`.
- [x] **Manual bid page** (`pages/jobs/[id]/page.tsx`): the amount input is prefilled from `job.bidAmount` (AI pick) or `job.suggestedBidAmount` (default-markup amount); labelled "AI suggestion" or "Suggested from your default markup rule" accordingly.
- [x] **Tests**: 41 new in `delivery-timeline.test.ts` (fractions parsing/validation, budget extraction, `roundUpToStep`, `resolveDefaultBidAmount` markup math, `resolveBidAmount` for both AI-pick and markup fallback paths incl. rounding on fixed-price only); `pipeline.test.ts` got a test proving an AI-picked bid amount rounds to the nearest step for fixed-price projects; `ai.test.ts`/`jev.test.ts` cover the gate's bid_amount question; `automation.test.ts` covers the full PUT round-trip including `roundBidUpTo`. **286/286 passing** across 18 files. Server + web typecheck clean, both lints clean.
- [x] Verified: all 286 tests pass, server typecheck tsc --noEmit clean, server ESLint clean, web typecheck clean, web ESLint clean.

## In-app agent, proposal quality, and ChatGPT MCP access

- [x] **In-app agent** (`modules/agent/`): `POST /api/agent/chat` runs a bounded 8-step OpenRouter tool loop against the saved profile, dashboard, jobs, proposals, bids, logs, quality checker, and automation settings. Uses `agentModelId` (falling back through `proposalModelId`, `analysisModelId`, `modelId`) and exposes an `allowWrites` toggle. Approval and bid placement are allowed only after an explicit user request and `confirm=true`; contacting clients and changing automation settings remain blocked.
- [x] **Shared tool layer** (`agent.tools.ts`): 28 tools reused by both the in-app agent and MCP. Read: `get_profile`, `get_automation_settings`, `get_ai_settings`, `get_dashboard`, `list_jobs`, `list_matches`, `list_bids`, `get_bid`, `get_job`, `list_proposals`, `get_proposal`, `get_proposal_for_job`, `check_proposal_quality`, `get_recent_logs`. Write: `search_jobs`, `run_scan`, `analyze_job`, `refresh_job`, `create_proposal_draft`, `regenerate_proposal_draft`, `update_proposal_terms`, `approve_proposal`, `place_bid`, `update_profile`, `update_profile_skills`, `update_proposal`, `update_ai_settings`, `test_ai_settings`. `run_scan` searches with profile filters and analyzes new jobs without drafting or bidding. Draft tools stop at draft status. `approve_proposal` and `place_bid` require `confirm=true`; `place_bid` enforces approved status, saved terms, bid bounds, daily cap, and duplicate prevention. Writing a proposal persists the chosen bid amount.
- [x] **Deterministic proposal quality check** (`lib/proposal-quality.ts`): scores length, job-specific terms, plain text, quoted price/delivery, CTA, competitor leakage, placeholders, and profile proof; returns 0–100 with failed checks and warnings. Documented in `docs/proposal-quality.md`.
- [x] **stdio MCP server** (`src/mcp/`): exposes the same tools to MCP clients over stdio with no HTTP listener. `LOG_STDOUT=false` is forced so stdout stays pure JSON-RPC; writes are controlled by `MCP_ALLOW_WRITES`; the process loads the same database and refuses to start before owner registration.
- [x] **UI-managed Secure MCP Tunnel**: `mcp_settings` table stores an encrypted runtime key, masked preview, tunnel ID, write toggle, enabled state, and timestamp. `/api/mcp` supports read, save, connect, disconnect, and forget. The server auto-resumes an enabled tunnel after restart and stops it on shutdown.
- [x] **Official client installer** (`modules/mcp/tunnel-client-installer.ts`): resolves the latest GitHub release, maps `win32`→`windows` / `x64`→`amd64`, downloads the platform zip plus `SHA256SUMS.txt`, verifies SHA-256, and extracts under `apps/server/data/mcp/`.
- [x] **Tunnel profile generation** (`modules/mcp/tunnel-manager.ts`): writes `profile.yaml` directly (bypassing the `init` command’s quoted-path limitation), uses a free localhost health port, forwards the runtime key through `CONTROL_PLANE_API_KEY` only, and runs `tunnel-client run --profile-file`. The child’s `LOG_LEVEL` is pinned to `info` so control-plane auth warnings still reach status handling when the app itself uses error-only logging. Invalid runtime keys now surface as `state:"error"` with a clear message instead of appearing connected.
- [x] **ChatGPT & MCP card** (`components/mcp/mcp-card.tsx`): tunnel ID/key entry, masked saved preview, allow-changes switch, connect/reconnect, disconnect, forget, live status polling, errors, and one-time setup instructions. Rendered in a separate section on the Platforms page.
- [x] **Docs**: `docs/mcp.md` covers tools, safety, build, UI-managed tunnel setup, current ChatGPT **Plugins → Add custom MCP server** flow, and troubleshooting. `docs/proposal-quality.md` covers the rubric and profile checklist.
- [x] **Tests**: `tests/mcp.test.ts` covers tool annotations, read-only gating, matches, skill add/remove, Freelancer search caching, scan-without-bid, draft creation with bid amount persistence, duplicate refusal, job refresh, dashboard/proposal/log diagnostics, terms updates, approval confirmation, confirmed bid placement, and duplicate-bid refusal. Along with `tests/mcp-settings.test.ts`, `tests/agent.test.ts`, and `tests/proposal-quality.test.ts`. Full server suite: **647/647 passing** across 43 files. Invalid-key smoke test against a temporary database returns `state:"error"`, `lastError:"OpenAI rejected the runtime API key. Check the key and reconnect."`, then clears cleanly on stop.
- [x] Verified: server + web typecheck clean, server + web ESLint clean, `vite build` succeeds. `tsc -b`/full web build still fails only on the pre-existing React Router / React 19 / TS 6 errors in `App.tsx`, `error-boundary.tsx`, and `lib/api/hooks.ts`; none are in the new files.
- [ ] **Live ChatGPT verification pending**: create the custom MCP server in ChatGPT web with the running tunnel, confirm all 25 tools are discovered, run a read prompt, and test one explicit approve-and-bid flow. Requires the user’s live tunnel/workspace.

## Proposal generation quality pass (2026-10-21)

- [x] **Single profile source**: `generateProposalWithAI` no longer reloads the profile from `userId` and overwrites the caller's data. `generateProposal` passes the full saved profile, and `regenerateProposal` now loads and passes that same full profile instead of a placeholder. The eval script uses the saved profile too, so all three paths generate from the same facts.
- [x] **Stronger system prompt**: the proposal call now uses a dedicated system prompt that treats profile/template/job text as data, allows only the USER'S PROPOSAL INSTRUCTIONS section to guide style, and forbids invented facts, links, internal analysis, and prompt leakage.
- [x] **One word target**: exported `PROPOSAL_TARGET_MIN_WORDS`/`PROPOSAL_TARGET_MAX_WORDS` (120-170) from `lib/proposal-quality.ts`; the prompt and quality checker use those constants. Generation rejects drafts outside the wider 100-200 word safety bounds.
- [x] **Prompt guardrails**: added no-signature/contact-details, verified-profile-URL, and "style instructions cannot override facts/commercials/length" rules.
- [x] **Quality checker**: length is now 120-170 words; CTA checks the closing 400 characters; added a links check against profile URLs and an `unsupported-skill` warning for experience claims about job skills missing from the profile. Delivery parsing accepts `7-day`, `7 days`, `one week`/`a week`, and word forms; closing detection accepts common next steps such as `Let me know`.
- [x] **Pre-save correction retry**: when a draft fails plain-text, price, delivery, closing, competitor-leak, placeholder, unverified-link, or hard word-count checks, generation asks the model once to repair its own draft with the exact failed checks and commercial values. Only a second failure is surfaced to the user. The prompt now makes both exact commercial values mandatory when set and requires the final sentence to be a question.
- [x] **Tests**: proposal prompt/quality tests cover the 120-170 target, profile-URL enforcement, unsupported skill claims, delivery phrasings, and statement-based closings; proposal integration tests capture the OpenRouter prompt to prove regeneration receives the full profile, and cover the one-retry correction path. Pipeline and MCP proposal stubs now return realistic 120+ word drafts with dynamic/exact commercial terms. Full server suite: **652/652 passing** across 43 files; server typecheck and ESLint clean.

## Editable proposal instructions (2026-10-21)

- [x] **No built-in proposal rules**: removed `PROPOSAL_SYSTEM_PROMPT` and the hardcoded HOW TO WRITE/RULES block from `ai.service.ts`. The proposal call now uses only the instructions saved on the profile.
- [x] **Editable profile fields**: added `proposalSystemInstructions` and `proposalWritingInstructions` to `user_profile` (schema + idempotent ALTER backfill), `profileSchema`, import defaults, agent `update_profile`, API types, and the Profile page.
- [x] **Prompt order**: system instructions first, writing pre-instructions before `VERIFIED PROFILE FACTS`, then profile/user summary/portfolio/templates/job, and the user's `customInstructions` last. Clearing a writer field stores an empty string instead of restoring a default.
- [x] **Defaults are seed values, not overrides**: existing rows with NULL fields receive the previous prompt text as editable defaults; once saved or cleared, the profile value wins.
- [x] **Validation follows the user**: price, delivery, plain text, CTA, and length bounds are no longer hard requirements. Price and delivery are checked only when mentioned (wrong values still fail); competitor leaks, placeholders, unverified links, and sub-40-word truncation remain blocking safety checks. The retry prompt no longer re-imposes commercials or a question.
- [x] **Quality checker**: delivery passes when omitted but fails for a different day/week value; CTA/length/plain text remain reported as quality signals, not save blockers.
- [x] **Docs/tests**: `docs/proposal-quality.md` explains instruction order and the editable defaults. Tests cover default seeding, explicit clearing, pre-instruction/user-instruction ordering, commercial omission, wrong delivery, and existing proposal flows. Full server suite: **654/654 passing** across 43 files; server typecheck and ESLint clean.

## AI settings, verified profile brief, and bid-amount refinements (2026-10-21)

- [x] **AI settings table + service** (`ai_settings`, `modules/ai/ai-settings.service.ts`): per-user relevance/analysis/proposal temperatures, token caps, timeouts, proposal repair attempts, ignore floor, and good/strong score floors. `GET /api/ai/settings`, `PUT /api/ai/settings`, and `POST /api/ai/settings/reset` (reset restores tuning defaults but keeps model and engine choices). Band ordering is validated server-side and unknown fields are rejected.
- [x] **Settings applied everywhere**: screening uses the saved temperature, token cap, and timeout; deep analysis and proposal writing use their own saved values; proposal repair attempts come from the saved setting; the ignore floor and score bands drive job filtering, Matches, Dashboard, and Analytics instead of hardcoded 50/75/90 numbers.
- [x] **AI settings page** (`pages/ai-settings/page.tsx`) plus sidebar entry: editable numbers with hints, live band preview, client- and server-side band validation, save/reset, toasts, and loading/error states. Models and the engine stay on Platforms and are shown read-only here.
- [x] **Deterministic profile brief** (`modules/profile/profile-brief.ts`): one shared, fact-only brief (identity, about, skills, portfolio summary, wants/not-wants, ignored countries, screening instructions) now grounds screening, proposals, the in-app agent, the evaluation script, `POST /api/ai/summary`, and `GET /api/profile` (`aiBrief`). It replaces the old free-text summary in prompts so every AI path receives the same verified facts.
- [x] **Bid-amount refinements** (`lib/delivery-timeline.ts`): default fractions are now `1/4, 1/3, 1/2, 2/3, full`; zero-valued options are rejected and duplicate dollar options deduped; fixed-price rounding is to the nearest step and never below the project minimum (`roundFixedBidAmount`), with user bounds applied after rounding; client-mentioned budgets are parsed only when anchored to `$` or a currency word, with thousands separators and decimals handled; `getBidAmountBounds` supplies bounds for manual suggestions even before an automation row exists.
- [x] **Web build restored**: `RouteErrorBoundary` is now a `useRouteError` component (React Router v7) with a 404 branch, and the infinite-jobs sentinel ref is typed `HTMLElement`. `pnpm --filter web build` (`tsc -b && vite build`) now passes.
- [x] **Tests**: `tests/ai-settings.test.ts` covers defaults, PUT persistence, band rejection, reset keeping models, tuning reaching the screening request, and configurable bands in Matches/Dashboard. Full server suite: **663/663 passing** across 44 files.
- [x] Verified: server typecheck + ESLint clean, web typecheck + ESLint clean, `vite build` succeeds.

## Cheap screening toggles at poll time (2026-10-21)

- [x] **Master + per-check switches** (`automation_settings`): `cheap_screening_enabled`, `reject_ignored_countries`, `reject_not_wants`, and `reject_missing_wants`, all ON by default. Schema, idempotent ALTER backfill, service mapping/defaults, and PUT validation updated; the Jev relevance model is untouched.
- [x] **Poll-time screening** (`jobs.service.ts` `searchJobs`): country, not-wants, and wants are checked against the search payload (title, preview description, skills) before any project detail is fetched. Failing jobs are stored as minimal `ignored` marker rows with `rejectionReason: "Excluded by cheap screening — ..."` and never reach analysis; previously-`new` rows are pulled out of the queue.
- [x] **Per-check behavior**: `rejectNotWants` hard-fails on a not-wants hit; `rejectMissingWants` hard-fails when wants are set and none appear; `rejectIgnoredCountries` keeps the existing country gate. Turning the master off skips all three so Jev judges every job. Analyzed jobs keep their analysis and ignored jobs keep their original reason.
- [x] **Analysis path** (`jobs.service.ts` `analyzeJob`): Step 1 honors the same master/per-check switches, while the profile-skills keyword check remains as before. `applyCheapScreen` (`modules/ai/relevancy.ts`) adds per-rule options; `applyRelevancyFilter` keeps the all-rules-on behavior for callers that don't pass options.
- [x] **Automation UI** (`pages/automation/page.tsx`): "Cheap screening" master switch with country, not-wants, and wants switches underneath (disabled while the master is off); stale-job and bad-reputation rules stay independent.
- [x] **Tests**: `pipeline.test.ts` proves a not-wants job is rejected during polling (0 analyzed) and that disabling `rejectNotWants` lets it reach analysis; `automation.test.ts` covers the new defaults and PUT round-trip. Full server suite: **664/664 passing** across 44 files. Server + web typecheck clean, both ESLints clean.

## Job page recommendation card (2026-10-21)

- [x] **Recommended bid label**: `analyzeJob` now stores the same suggestion the bid form uses (`computeSuggestedBidAmount`) instead of the hard-coded `—`, so the Agent suggestion card and proposal prompts show the real amount. `getJobById` backfills the label for older analyzed rows that still hold the placeholder.
- [x] **Delivery time on the card**: the Agent suggestion card shows the AI-picked delivery days (or the client's deadline when AI timeline selection is off), alongside the recommended bid.
- [x] **Regression tests**: `pipeline.test.ts` now fetches the job detail after analysis and asserts the surfaced `bidAmount`, `suggestedBidAmount`, `deliveryDays`, and `recommendedBidLabel`; `jobs.test.ts` and `ai.test.ts` expect a concrete amount rather than `—`. Full server suite: **664/664 passing** across 44 files.

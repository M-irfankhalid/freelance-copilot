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

## Phase 1, Frontend, Mock Data Only, Current Phase

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

- [ ] User visual verification of all Phase 1 screens — gate before backend work starts

## Phase 2, Backend Foundation

Not started. Waiting on Phase 1 verification.

## Verification Log

Record of user review sessions:

| Date | Scope reviewed | Result |
| ---- | -------------- | ------ |
| —    | —              | —      |

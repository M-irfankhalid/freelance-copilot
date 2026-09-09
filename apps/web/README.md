# Web App

React 19 + Vite + TypeScript frontend for Freelance Copilot.

- `pnpm dev` — dev server on :5173, `/api` proxied to the Express server on :4000
- `pnpm build` — typecheck + production build
- `pnpm lint` — ESLint

All data comes from the mock layer in `src/lib/data/`. Components consume only
the domain types in `src/lib/types.ts`, so swapping mocks for real API calls
(Phase 3) should not touch component code.

# Web App

React 19 + Vite + TypeScript frontend for Freelance Copilot.

## Scripts

- `pnpm dev` — dev server on `:5173`, with `/api` proxied to the Express server on `:4000`
- `pnpm build` — typecheck and production build
- `pnpm typecheck` — TypeScript project build
- `pnpm lint` — ESLint

## Structure

- `src/pages/` — route-level screens
- `src/components/` — layout, shared, and UI components
- `src/lib/` — API client, auth context, domain types, and utilities

The production build is served by the API server from `apps/web/dist`, so the
app and API share an origin.

# Contributing

Thanks for taking the time to improve Freelance Copilot.

## Development setup

Requirements: Node.js 20+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

The API runs on `http://localhost:4000` and the web app on `http://localhost:5173`.

Copy `.env.example` to `.env` and fill in the values you need. The database is
created automatically at `apps/server/data/app.db`.

## Before opening a pull request

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- Keep changes focused. Unrelated refactors make review harder.
- Add or update tests for behavior you change.
- Never commit `.env`, API keys, access tokens, or database files.
- Keep the existing code style and folder layout.

## Project layout

- `apps/server` — Express API, SQLite/Drizzle persistence, AI pipeline, and MCP server
- `apps/web` — React frontend
- `docs` — MCP setup and proposal quality notes

## Reporting bugs

Open an issue with the version or commit, what you expected, what happened, and
the relevant log lines. Remove credentials and personal data first.

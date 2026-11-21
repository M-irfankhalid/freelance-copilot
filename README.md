# Freelance Copilot

**A self-hosted AI agent that finds relevant projects on Freelancer.com and
drafts quality proposals for you — so you can focus on your work while the
agent handles discovery.**

The agent watches for new projects that match your skills and preferences,
analyses each one against your real profile, and writes a proposal grounded in
facts you have verified. Auto-bidding is strictly opt-in and gated by the
safety limits you set: a minimum match score, bid bounds, and a daily cap.

> ⚠️ **Responsible use.**
> Do **not** use this software to spam Freelancer.com or to send mass,
> unsolicited, or low-quality bids. It is built for good-faith use only: bidding
> on projects that genuinely match your profile. The whole point is to help real
> freelancers spend less time hunting and more time delivering — not to flood
> the platform. Abusing a freelancing marketplace can get accounts suspended and
> hurts the freelancers who use it honestly. Always respect Freelancer.com's
> Terms of Service and this tool's own safety limits.

## Features

• Job discovery through configurable polling
• AI job analysis and matching against your profile
• Project file inspection
• AI proposal generation grounded in your real profile
• Manual bidding with a review step
• Opt-in auto-bidding with score threshold, bid bounds, and daily cap
• Cached bid insights per job with on-demand refresh
• Full system activity logs
• Analytics

## BYOC

Bring Your Own Credentials.

Each installation uses the user's own:

• Freelancer.com access token
• OpenRouter API key, with a user selected model

Credentials are stored securely on the user's own server. This is a
single-user, self-hosted application — your data and keys never leave your
machine.

## Stack

• React
• Vite
• TypeScript
• Node.js
• Express
• SQLite
• Drizzle
• OpenRouter

## Development

Requirements:

• Node.js 20+
• pnpm

Install dependencies and run locally:

```bash
pnpm install
pnpm dev
```

The API serves on `http://localhost:4000` and the web app on `http://localhost:5173`.

Useful checks:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Run it (Docker, recommended)

One container serves both the API and the web app:

```bash
cp .env.example .env
# Set ENCRYPTION_KEY in .env (see the comment in .env.example)
docker compose up -d --build
```

Open `http://localhost:4000` and create the owner account. After that, new
registrations are disabled and the installation belongs to that account.

Everything persistent lives in `apps/server/data/` (SQLite database and MCP
tunnel files), which is mounted into the container. To back it up:

```bash
docker compose stop
cp -a apps/server/data "apps/server/data.backup-$(date +%F)"
docker compose start
```

Upgrading is:

```bash
git pull
docker compose up -d --build
```

The container runs as uid 1000. If `apps/server/data` is owned by another
user, run `sudo chown -R 1000:1000 apps/server/data` once.

The server creates and updates its own SQLite schema on startup, so there is
no separate migration step.

Set `APP_PORT` if port 4000 is already in use, and set `CLIENT_ORIGIN` to your
public URL if you put the container behind a reverse proxy. Production session
cookies are `Secure`, so use HTTPS for anything other than `localhost`. For a
trusted LAN install over plain HTTP, set `COOKIE_SECURE=false`.

## Run it without Docker

```bash
pnpm install
pnpm --filter web build
pnpm --filter server build
NODE_ENV=production pnpm --filter server start
```

The server serves the built web app from `apps/web/dist` on
`http://localhost:4000`.

## MCP

A local stdio MCP server exposes the profile, jobs, proposals, quality checks,
and draft-only edits to ChatGPT (through Secure MCP Tunnel) and other MCP
clients. See [docs/mcp.md](docs/mcp.md) for setup, safety, and tool details.

## Contributing

Bug reports, fixes, and focused improvements are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[SECURITY.md](SECURITY.md) for reporting security issues.

## Maintainer

Built and maintained by [Muhammad Irfan Khalid](https://irfankhalid.com),
released as open source by [sofNxt](https://sofNxt.com).

## License

Released under the [MIT License](LICENSE). © 2026 Muhammad Irfan Khalid.

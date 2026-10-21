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

## MCP

A local stdio MCP server exposes the profile, jobs, proposals, quality checks,
and draft-only edits to ChatGPT (through Secure MCP Tunnel) and other MCP
clients. See [docs/mcp.md](docs/mcp.md) for setup, safety, and tool details.

> Docker packaging is planned but not yet shipped.

## Maintainer

Built and maintained by [Muhammad Irfan Khalid](https://irfankhalid.com),
released as open source by [sofNxt](https://sofNxt.com).

## License

Released under the [MIT License](LICENSE). © 2026 Muhammad Irfan Khalid.

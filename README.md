# Freelancer Agent

An open source, self hosted AI agent for freelancers using Freelancer.com.

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

Credentials are stored securely on the user's own server.

## Stack

• React
• Vite
• TypeScript
• Node.js
• Express
• SQLite
• Drizzle
• OpenRouter
• Docker

## Development

Requirements:

• Node.js
• pnpm
• Docker

Install dependencies:

```bash
pnpm install
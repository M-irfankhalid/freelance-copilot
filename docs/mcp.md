# MCP Server

Freelance Copilot ships a local **stdio MCP server** so MCP clients can inspect
the owner's saved profile, dashboard, jobs, proposals, bids, logs, quality
checks, and automation settings. With writes enabled it can also scan and
analyze Freelancer.com jobs, create or improve **draft** proposals, update
profile and draft terms, approve a draft, and place a real bid after explicit
confirmation.

The MCP server is not a second application. It opens the same SQLite database
and reuses the same validated tool implementations as the in-app agent.

## Tools

| Tool | Access | Purpose |
| --- | --- | --- |
| `get_profile` | Read | Full saved profile. The only source of truth for user facts. |
| `get_automation_settings` | Read | Bid bounds, thresholds, daily cap, delivery and pricing settings. |
| `get_ai_settings` | Read | Active models/engine plus temperatures, token caps, timeouts, repair attempts, and score bands. Never exposes keys. |
| `update_ai_settings` | Write | Update AI tuning and/or the active models and analysis engine. Validates score-band ordering. |
| `test_ai_settings` | Write | Test the saved OpenRouter connection used by the active AI models and return current settings. Makes a network call. |
| `get_dashboard` | Read | Dashboard KPIs, match bands, attention items, recent proposals/bids, connections, and activity. |
| `list_jobs` | Read | Stored jobs with filters and content previews. |
| `list_matches` | Read | Analyzed jobs scored against the profile, with matched/missing skills and concerns. |
| `list_bids` | Read | The owner's own bids with amounts, delivery, outcome, and manual/auto source. |
| `get_bid` | Read | One bid in full, including the submitted proposal text. |
| `get_job` | Read | One stored job with analysis, score, skills, and description. |
| `search_jobs` | Write | Search Freelancer.com and cache new jobs. Does not analyze or bid. |
| `run_scan` | Write | Search with profile filters and analyze newly found jobs. Never writes proposals or bids. |
| `analyze_job` | Write | Re-run relevance analysis for one stored job. Never writes a proposal or bids. |
| `refresh_job` | Write | Refresh one stored job and its competition data from Freelancer.com. |
| `list_proposals` | Read | Recent proposals with status, bid, and content preview. |
| `get_proposal` | Read | Full proposal content and competitor note. |
| `get_proposal_for_job` | Read | The full proposal attached to a project, plus its current bid and delivery terms. |
| `check_proposal_quality` | Read | Deterministic quality score, failed checks, and warnings. |
| `create_proposal_draft` | Write | Generate an AI proposal draft. Never approves, submits, or bids. |
| `regenerate_proposal_draft` | Write | Regenerate a draft, optionally with a new bid amount or delivery time. |
| `update_proposal_terms` | Write | Change bid amount, delivery days, or text on a **draft** only. |
| `approve_proposal` | Write | Move a **draft** to approved. Requires `confirm: true`. Does not bid. |
| `place_bid` | Write | Place a real Freelancer.com bid from an **approved** proposal. Requires `confirm: true`, saved terms, bounds/cap checks, and duplicate prevention. |
| `update_profile` | Write | Patch saved profile fields with validation. |
| `update_profile_skills` | Write | Add or remove named skills while preserving the rest. |
| `update_proposal` | Write | Replace the text of a **draft** proposal only. |
| `get_recent_logs` | Read | Recent logs filtered by level, category, or message for diagnostics. |

`run_scan` and `analyze_job` never write proposals and never place bids.
`create_proposal_draft` and `regenerate_proposal_draft` stop at draft status.
`place_bid` is the only tool that submits a bid to Freelancer.com; it refuses
anything that is not approved, requires `confirm: true`, and enforces the saved
bid bounds, daily cap, and one-bid-per-project rule. The server cannot submit a
proposal outside that bid flow, contact clients, or change automation settings.

## Safety rules

- The server has no HTTP listener and no inbound port. It communicates over
  stdio only.
- MCP clients should ask for confirmation before write tools. ChatGPT does this
  by default and can remember the answer for one conversation.
- `update_proposal`, `update_proposal_terms`, and `regenerate_proposal_draft`
  reject every status except `draft`, including approved and submitted
  proposals.
- `create_proposal_draft` and `regenerate_proposal_draft` stop at `draft`; they
  never approve, queue, submit, or place a bid.
- `approve_proposal` and `place_bid` both require `confirm: true`. A request to
  place a bid also authorizes approving that draft, but no other write does.
- `place_bid` refuses when the proposal is not approved, no amount or delivery
  time is saved, the amount is outside the configured bid bounds, the daily cap
  is reached, or a bid already exists for the project.
- `run_scan` and `analyze_job` require writes enabled because they update the
  local job cache, but neither one drafts a proposal or places a bid.
- `search_jobs` and `refresh_job` only refresh the local job cache; neither one
  runs the analysis pipeline or places a bid.
- `update_profile_skills` only adds or removes named skills and never invents
  skills the user did not provide.
- Profile writes use the existing Zod schema and reject unknown fields.
- The AI must use only saved profile facts and must never invent skills,
  portfolio projects, history, prices, or deadlines.
- Use the **Allow changes** switch on the Platforms page to choose between
  read-only and write-capable tools. For local MCP clients, set
  `MCP_ALLOW_WRITES=false` in the client environment or `apps/server/.env`.

## Build

The stdio process must write only JSON-RPC to stdout. The UI-managed tunnel
automatically uses the TypeScript entry through `tsx` in development, or the
compiled entry after a build. To build for a production/local MCP client:

```bash
pnpm --filter server build
node apps/server/dist/src/mcp/index.js
```

Do **not** launch the stdio server through `pnpm --filter server mcp` as a
machine-read tunnel command because pnpm prints its script banner to stdout and
corrupts the stream.

The process loads the same `.env` as the API server and refuses to start until
the installation owner has registered. Relative `DATABASE_PATH` values resolve
from `apps/server`, so the MCP process uses the same database regardless of the
directory it is launched from.

## ChatGPT with Secure MCP Tunnel

ChatGPT cannot connect to a local stdio server directly. Use OpenAI's
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels);
the server stays private and the tunnel client makes only outbound connections.

Full MCP support, including write tools, currently requires a ChatGPT Business,
Enterprise, or Edu workspace. Pro and personal accounts may be limited to
read-only or unable to add write-capable custom servers. Workspace policies and
permissions still apply.

The tunnel is managed entirely from **Platforms → ChatGPT & MCP**. No terminal
commands are required.

1. Open
   [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels),
   create a tunnel, and note its `tunnel_id`. Create a runtime API key in
   [OpenAI API keys](https://platform.openai.com/settings/organization/api-keys)
   and associate the tunnel with the ChatGPT workspace that will use it.

2. In the app, open **Platforms → ChatGPT & MCP**. Paste the tunnel ID and
   runtime API key, choose whether ChatGPT may make changes, and press
   **Connect**.

   The server downloads the official `tunnel-client` release for its platform,
   verifies the published SHA-256 checksum, extracts it under
   `apps/server/data/mcp/`, writes a stdio profile, and starts the process. The
   runtime key is encrypted at rest and passed to the process through
   `CONTROL_PLANE_API_KEY`; it is never written into the profile.

   The tunnel resumes automatically after a server restart while it remains
   connected. Press **Disconnect** to stop it and disable auto-resume.

3. In **ChatGPT web**, open **Plugins**, select **+**, then **Add custom MCP
   server**. Enter a name, choose **Connection → Tunnel**, and select this
   tunnel (or paste its `tunnel_id`). Use **No authentication** because the MCP
   server has no public endpoint; access is controlled by the tunnel's workspace
   association. Accept the risk warning and select **Create as a plugin**.
   Developer mode is not required. On Business workspaces only admins/owners can
   create custom MCP apps; Pro accounts may be limited to read-only tools.

4. Start a chat, type `@`, select the connector, and ask it to read the profile
   or a recent proposal. Approve write calls only after checking the JSON
   arguments.

Keep the app server running while ChatGPT uses the tunnel. If tools change,
restart the tunnel from the card, then refresh the connector's actions in
ChatGPT workspace settings. ChatGPT keeps a frozen tool snapshot until an admin
refreshes it.

## Local MCP clients

Example client configuration:

```json
{
  "mcpServers": {
    "freelance-copilot": {
      "command": "node",
      "args": ["E:/freelancer-agent/apps/server/dist/src/mcp/index.js"]
    }
  }
}
```

Set `MCP_ALLOW_WRITES=false` in the client environment for read-only access.

## Troubleshooting

- **"No owner account exists"** — start the app and register first.
- **Could not download the tunnel client** — the server needs outbound HTTPS
  access to `api.github.com` and `github.com`. Press **Connect** again after
  fixing connectivity.
- **OpenAI rejected the runtime API key** — create a fresh runtime key for the
  same tunnel, paste it into the card, and reconnect.
- **Tool missing in ChatGPT** — restart the tunnel from the card, then refresh
  the connector's actions in ChatGPT workspace settings.
- **Write tool returns a disabled error** — **Allow changes** is off, or
  `MCP_ALLOW_WRITES=false` is set in the environment.
- **Tunnel not listed** — verify it is associated with the ChatGPT workspace,
  not only a Platform organization, and that the operator has Tunnels Read +
  Use permission.
- **Tunnel stops after a server restart** — it only auto-resumes while it was
  left connected. Press **Connect** once; future restarts resume automatically.
- **Wrong database** — relative `DATABASE_PATH` values resolve from
  `apps/server`, so the MCP process uses the same file regardless of the
  directory it is launched from.

# MCP Server

Freelance Copilot ships a local **stdio MCP server** so MCP clients can inspect
the owner's saved profile, dashboard, jobs, proposals, bids, logs, quality
checks, automation settings, and the full proposal engine. With writes enabled
it can also scan and analyze Freelancer.com jobs, change automation and AI
settings, edit proposal prompts/policy/playbooks, manage the owner's voice
samples, create or improve **draft** proposals, update profile and draft terms,
approve a draft, and place a real bid after explicit confirmation.

The MCP server is not a second application. It opens the same SQLite database
and reuses the same validated tool implementations as the in-app agent.

## Tools

| Tool | Access | Purpose |
| --- | --- | --- |
| `get_profile` | Read | Full saved profile. The only source of truth for user facts. |
| `get_automation_settings` | Read | Bid bounds, thresholds, daily cap, delivery and pricing settings. |
| `update_automation_settings` | Write | Update bid bounds, score floors, max bids/day, delivery options, bid fractions, paused, and screening toggles. |
| `reset_daily_bid_usage` | Write | Reset today's bid counter after an explicit request. |
| `get_ai_settings` | Read | Active models/engine plus temperatures, token caps, timeouts, repair attempts, and score bands. Never exposes keys. |
| `update_ai_settings` | Write | Update AI tuning and/or the active models and analysis engine. Validates score-band ordering. |
| `test_ai_settings` | Write | Test the saved OpenRouter connection used by the active AI models and return current settings. Makes a network call. |
| `reset_ai_settings` | Write | Restore AI tuning defaults (temperatures, token caps, timeouts, correction attempts, score bands). Leaves model selections and the analysis engine untouched. |
| `get_proposal_system` | Read | Engine defaults, stages, custom flow, context files, prompts, contracts, policy, checks, playbooks, samples, and audit settings. |
| `save_proposal_engine` | Write | Change pipeline structure: candidate lanes, flow and context files, stage toggles, models, temperatures, timeouts, limits, and contracts. |
| `save_proposal_prompts` | Write | Change the built-in brief/writer/judge/reviewer/reviser/deleter prompts only. |
| `save_proposal_policy` | Write | Change length, format, commercial wording, questions, evidence/links, and banned phrases only. |
| `save_proposal_checks` | Write | Change hard, policy, advisory, and anti-AI-tell checks only. |
| `upgrade_proposal_engine` | Write | Upgrade untouched proposal defaults while preserving edits. |
| `reset_proposal_engine` | Write | Restore engine, prompts, policy, and checks to shipped defaults. |
| `save_proposal_playbook` | Write | Create a playbook when `playbookId` is omitted, or update one when provided. |
| `delete_proposal_playbook` | Write | Permanently delete one playbook. |
| `save_profile_audit_settings` | Write | Change profile-audit rules, prompt, model, and run-on-save. |
| `run_profile_audit` | Write | Run the profile audit now and save the result. |
| `list_voice_samples` | Read | The owner's saved voice samples with ids, titles, content, ratings, tags, and active state. |
| `save_voice_sample` | Write | Create a voice sample when `sampleId` is omitted, or update only the passed fields when `sampleId` is provided. Requires `title` and `content` (20+ characters) on create. |
| `delete_voice_sample` | Write | Permanently delete one voice sample by `sampleId`. |
| `delete_all_voice_samples` | Write | Permanently delete every voice sample. Requires `confirm: true`. |
| `import_voice_samples` | Write | Import selected bids as inactive voice samples. Requires `bidIds`; there is no import-all shortcut. Skips duplicates and very short bids. |
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
| `list_proposal_traces` | Read | Recent proposal generation runs, optionally filtered by proposal or internal job id. |
| `get_proposal_trace` | Read | One run's phase timeline and diagnostics. Set `includePayloads: true` for exact prompts and raw responses. |
| `create_proposal_draft` | Write | Generate an AI proposal draft. Never approves, submits, or bids. |
| `regenerate_proposal_draft` | Write | Regenerate a draft, optionally with a new bid amount or delivery time. |
| `update_proposal_terms` | Write | Change bid amount, delivery days, or text on a **draft** only. |
| `approve_proposal` | Write | Move a **draft** to approved. Requires `confirm: true`. Does not bid. |
| `place_bid` | Write | Place a real Freelancer.com bid from an **approved** proposal. Requires `confirm: true`, saved terms, bounds/cap checks, and duplicate prevention. |
| `update_profile` | Write | Patch saved profile fields with validation. |
| `update_profile_skills` | Write | Add or remove named skills while preserving the rest. |
| `update_proposal` | Write | Replace the text of a **draft** proposal only. |
| `delete_proposal` | Write | Permanently delete a **draft** proposal. Approved and submitted proposals are refused. |
| `get_recent_logs` | Read | Recent logs filtered by level, category, or message for diagnostics. |

`run_scan` and `analyze_job` never write proposals and never place bids.
`create_proposal_draft` and `regenerate_proposal_draft` stop at draft status.
`list_proposal_traces` and `get_proposal_trace` are read-only diagnostics for
explaining weak proposals; payloads are omitted unless
`includePayloads: true` is explicitly requested.
`place_bid` is the only tool that submits a bid to Freelancer.com; it refuses
anything that is not approved, requires `confirm: true`, and enforces the saved
bid bounds, daily cap, and one-bid-per-project rule. The server cannot submit a
proposal outside that bid flow or contact clients.

## Editing proposal generation settings

Each proposal-system section has its own tool. Read `get_proposal_system` first
and send only the fields that need to change. Each tool schema describes its
property purposes.

| Goal | Tool and setting |
| --- | --- |
| Proposal length | `save_proposal_policy` -> `words.min` / `words.max` |
| Tone and persistent writing rules | `save_proposal_engine` -> `contracts.writer` |
| Review strictness and coverage rules | `save_proposal_engine` -> `contracts.reviewer` |
| Revision behavior | `save_proposal_engine` -> `contracts.reviser` |
| Stage instructions | `save_proposal_prompts` |
| Generic or AI-sounding phrases | `save_proposal_checks` -> `antiAiTells`, or `save_proposal_policy` -> `bannedPhrases` |
| Hard, policy, and advisory failures | `save_proposal_checks` |
| Price and delivery wording | `save_proposal_policy` -> `commercials` |
| Evidence and links | `save_proposal_policy` -> `maxEvidence` / `includeLinks`, and `save_proposal_engine` -> `maxEvidenceItems` |
| Question policy | `save_proposal_policy` -> `askQuestion` |
| Candidate count and variety | `save_proposal_engine` -> `candidateLanes` / `temperatures.writer` |
| Stage cost and quality | `save_proposal_engine` -> `stages` / `models` / `temperatures` / `timeoutsSeconds` |
| Revision and repair attempts | `save_proposal_engine` -> `maxRevisionAttempts` / `maxRepairAttempts` |
| Custom pipeline and context files | `save_proposal_engine` -> `flow` |
| Job-type strategy | `save_proposal_playbook` / `delete_proposal_playbook` |
| Voice and writing examples | `save_voice_sample` / `delete_voice_sample` / `delete_all_voice_samples` / `import_voice_samples` (`bidIds` for selected bids) |
| Profile evidence and proposal instructions | `update_profile` (`portfolioSummary`, `proposalTemplates`, `proposalSystemInstructions`, `proposalWritingInstructions`) |
| Proposal model, temperature, timeout, corrections | `update_ai_settings` |

Do not rewrite prompts or contracts to fix one bad draft. Inspect
`list_proposal_traces` / `get_proposal_trace` first, then change the smallest
relevant setting.

Not editable through MCP because they are code behavior, not saved settings:
quality rubric internals, evidence ranking, coverage reconciliation, style gate,
deletion guard, voice-guide prompt, and platform credentials.

## Safety rules

- The server has no HTTP listener and no inbound port. It communicates over
  stdio only.
- MCP clients should ask for confirmation before write tools. ChatGPT does this
  by default and can remember the answer for one conversation.
- `update_proposal`, `update_proposal_terms`, `regenerate_proposal_draft`, and
  `delete_proposal` reject every status except `draft`, including approved and
  submitted proposals.
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
- `update_automation_settings` uses the same validated schema as the web app;
  changes to bid bounds are checked before saving.
- `reset_daily_bid_usage` resets only today's counter and must be used only when
  the owner explicitly asks for it.
- `reset_ai_settings` restores AI tuning only. It never changes the selected
  models or the analysis engine.
- `upgrade_proposal_engine` upgrades untouched saved defaults and preserves
  customized values. `reset_proposal_engine` replaces the saved engine, prompts,
  policy, and checks with current defaults.
- Voice samples must be written by the owner. `save_voice_sample` never invents
  text, `import_voice_samples` imports only the owner's own bids, and imported
  samples start inactive. `import_voice_samples` requires explicit `bidIds`; it
  cannot import every bid by default. `delete_all_voice_samples` requires
  `confirm: true`.
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

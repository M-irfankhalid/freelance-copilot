# Proposal Quality Playbook

This document explains how this app generates proposals and how to evaluate them.
It applies to the production pipeline, not the legacy single-prompt generator.

## Why proposals can feel generic

The generator may only use verified profile facts. It cannot invent experience,
clients, certifications, or portfolio work. When the profile and portfolio are
thin, a proposal can only rely on `About`, `Skills`, and the job description.

The other common causes are:

- A small/fast model is selected for writing. Writing needs a stronger model than
  screening.
- The job description is vague, so the brief has no concrete deliverables,
  acceptance criteria, or dependencies to work from.
- The profile is full of broad claims ("expert", "passionate") instead of
  concrete work and outcomes.
- The selected voice samples are not examples of the owner's real writing.
- A saved policy is too narrow or contradicts the job (for example, forbidding
  commercial terms when the client explicitly asks for a price).
- Someone replaced the pipeline with a single prompt. That path is intentionally
  not used for production proposals.

## Pipeline

By default `apps/server/src/modules/proposals/proposal-pipeline.service.ts` runs these stages. An owner can replace them with a custom flow in **Proposal System -> Pipeline -> Use custom flow**.

1. **Brief** — extract facts, hypotheses, deliverables, explicit questions,
   acceptance criteria, dependencies, unknowns, risks, and one useful question.
   A deterministic fallback fills missing fields and never treats skill tags as
   deliverables.
2. **Evidence selection** — split the portfolio into projects, rank them against
   the job title, description, skills, and brief, and pass only strong matches.
   Weak matches are omitted, not padded into the prompt.
3. **Candidates** — run every enabled candidate lane. Candidates with hard or policy
   failures are excluded from judging when a compliant candidate exists.
4. **Blind judge** — rank eligible candidates with the shared rubric, deterministic
   flags, and no knowledge of generation order.
5. **Review** — check job understanding, specificity, technical judgment,
   evidence, voice, naturalness, conciseness, grounding, policy, and coverage.
   Missing deliverables force a revision through the coverage gate. Deterministic
   consultant framing, self-disqualification, and vague examples also force a
   revision even when the model reviewer accepted the prose.
6. **Targeted revision** — fix only review findings. Preserve strong sentences,
   the owner's voice, and every material deliverable.
7. **Naturalness rewrite** — one targeted pass removes generic phrasing when
   deterministic warnings remain. It is rejected if coverage or evidence drops.
8. **Optional deletion** — runs only when the draft is over the ceiling or carries
   observable filler. A candidate cut is rejected if it loses coverage or crosses
   a word boundary.
9. **Deterministic validation** — hard and policy checks. One targeted repair is
   allowed. A final check failure keeps the generated draft, adds the failures to
   the review, and marks it `needs_revision`; it is never auto-approved or
   discarded. A failed final review makes the draft need human approval; it never
   keeps an old accepting review. Trailing letter sign-offs are removed.

## Voice learning

Selected voice samples are **not** passed to the writer. A separate voice stage
reads them and produces an abstract style guide: rhythm, openings, structure,
closings, directness, habits, and things to avoid. Only that guide reaches the
writer, judge, reviewer, and reviser.

This prevents the model from treating an old proposal as a template or copying
its client details, deliverables, links, and job facts. The guide is sanitized:
sample titles, URLs, long verbatim fragments, and quoted sentences are removed
before use. If the voice stage fails, a deterministic analysis of sentence and
paragraph rhythm is used instead.

The guide is cached per user, model, and sample content, so editing a sample
invalidates it automatically. For the best results, use a stronger model for
writing than for screening; a small model can still flatten a good style guide.

## Editable writing and review contracts

The writer, reviewer/judge, and reviser each get a contract appended after their
configured prompt. These are saved settings, not code. Edit them in **Proposal
System -> Prompts -> Writing and review contracts**; this document is a reference
and is not loaded at runtime.

- The writer contract supports `{{wordTarget}}` and `{{relationshipGuidance}}`.
- The reviewer/judge contract supports `{{relationshipGuidance}}`.
- The reviser contract is appended unchanged.
- An empty contract disables that block.

`{{wordTarget}}` is calculated from the saved policy word range, the relationship,
and the number of deliverables. Its upper bound is always the policy maximum.
`{{relationshipGuidance}}` is filled for either a normal client project or a
recruiter/candidate opportunity. The base prompt still defines the task; the
contract carries the highest-priority tone, coverage, and review rules. Change
the contract, not the base prompt, when tuning voice, structure, or review
standards.

## Candidate lanes and per-stage models

Candidate lanes are saved settings, not code. Edit them in **Proposal System ->
Pipeline -> Candidate lanes**. Each lane has:

- a label and a lane ID (used as the candidate shape),
- its own writer guidance,
- an optional model override,
- an optional temperature override,
- an optional timeout override,
- an enabled toggle.

Every enabled lane is one writer call. The lane that matches the brief's shape
runs first; the others follow. Removing a lane removes that writer call. The
judge still compares eligible candidates, so a single lane skips the judge call.
If every lane is disabled, the pipeline falls back to one brief-shaped writer
call rather than failing.

The same **Pipeline** tab exposes the model, temperature, and timeout for every
stage, plus the revision/repair limits and candidate-lane count. An empty stage
model inherits the proposal model selected on the Platforms page. A lane model
overrides the writer-stage model for that lane only. This makes it possible to
keep the writer on a strong model while using a cheaper model for the brief,
judge, reviewer, reviser, or deletion pass.

## Custom flow

A custom flow is saved in `engine.flow` and replaces the built-in stages,
candidate lanes, contracts, and stage prompts when `engine.flow.enabled` is true.
It is intentionally explicit: the app passes only the variables referenced in
each step's prompts. Steps run in array order.

Each step has:

- a unique `id` (used as `{{step_<id>}}`),
- a label and a type: `brief`, `write`, `judge`, `review`, `revise`, `custom`, or
  `final`,
- an enabled toggle,
- system and user prompts,
- an optional model, temperature, and timeout,
- optional context file IDs.

`write` steps become judge candidates. `judge` chooses among the collected
`write` outputs. `review` returns the same structured review used by the built-in
pipeline. `revise` applies text changes only when the latest review verdict is
`revise`; otherwise it leaves the draft untouched. `custom` always returns text.
`final` copies the latest text without a model call. Add, remove, and reorder
steps in the UI or through `save_proposal_engine` -> `flow.steps`.

Available template variables include `jobJson`, `jobBriefJson`, `profileFacts`,
`profileSummary`, `ownerInstructions`, `ownerTemplates`, `playbook`, `samples`,
`evidence`, `policyJson`, `antiAiTells`, `hardChecks`,
`draft`, `lastOutput`, `candidatesJson`, `reviewJson`, `revisionInstructions`,
`mustKeep`, `stepOutputsJson`, `files`, `step_<id>`, and `file_<id>`. Unknown
variables render as empty text. Context files are saved in `engine.flow.files`
and can hold project notes, service descriptions, or other owner reference
material. Select files on a step to include them in `{{files}}`; `{{file_<id>}}`
is available directly. Flows are capped at 24 steps, 25 files, and 120,000
characters of context files in total.

Custom flows do not run the built-in commercial stripping, deletion, or
deterministic repair passes, but a trailing letter sign-off is removed from
`write` and `revise` outputs. A configured `review` step still controls whether
the draft is approvable. When review returns `revise` and no later `revise` step
is configured, the pipeline applies one targeted revision with the saved reviser
prompt and contract, so review findings are not merely diagnostic. Add an explicit
`revise` step when you want to control that pass. Use the built-in pipeline when
those safeguards matter more than full control.

## Structured output

Stages that must return an object use a provider-enforced JSON schema, not only
a prompt instruction:

- job brief
- voice guide
- judge
- reviewer
- profile audit

The schemas are generated from the same Zod validators used to parse the reply,
so the output contract cannot drift from validation. Before sending, the schema
is normalized to the provider's strict subset: generator-only keys are removed,
every object must reject unknown keys, and every property is marked required
(even when Zod would treat it as optional because it has a default). If the
selected model or provider rejects `response_format`, the call is retried once
as plain text and the existing JSON extraction/fallback still applies. Writer,
reviser, and deleter remain free-form text because their output is the proposal
itself.

## Shared writing rubric

`apps/server/src/lib/proposal-rubric.ts` defines the same standards for prompts,
deterministic checks, and tests:

- Open with the client's actual problem, risk, recommendation, or a useful
  diagnostic question. Simple jobs may open directly.
- Explain the approach through deliverables, constraints, dependencies, and
  acceptance criteria. Say why a step matters instead of listing technologies.
- Show competence through decisions and verification, not self-praise.
- Use only verified facts and relevant selected evidence. Never invent clients,
  results, metrics, credentials, links, prices, or delivery times.
- Keep the proposal as short as the job allows while covering every requirement.
  Never pad to reach a word count.
- Vary the shape. A bug fix is not a SaaS implementation plan.
- End naturally. A question or next step is optional unless policy requires one.
- Avoid generic openings, generic claims, forced credentials paragraphs,
  repeated requirements, and project-management language.

## Deterministic checks

`apps/server/src/lib/proposal-quality.ts` is a fast first pass, not a replacement
for reading the proposal. The saved policy owns the word range, commercial rules,
format, question policy, banned phrases, and checks.

| Check | What it verifies |
| --- | --- |
| Length | The draft is inside the saved policy word range |
| Specific | At least three terms from the job title, description, or skills |
| Plain | No headings, bullets, markdown, or code blocks in natural format |
| Price / Delivery | Mentions match the chosen bid values, or are absent when forbidden |
| Competition | Does not expose competitor counts or bid statistics |
| Placeholder | No `[brackets]`, "your name", or lorem ipsum |
| Links | Only cites URLs found in the portfolio |
| Proof | References a relevant profile skill when the job tags overlap the profile; unrelated jobs do not require a skill mention |
| Opening | Reports a generic greeting or willingness opening |
| Natural | No generic opening/claims, consultant framing, self-disqualification, or vague example claims |
| Warnings | Generic claims, repeated sentences, unverified results, and unsupported skills |

Each warning also lowers the score by 5 points, capped at 30. A score below 80
usually needs editing. A score of 100 only means the mechanical checks passed;
it still needs a human read.

Checks marked `hard` still block automation, but they no longer throw away a
generated draft. The draft is saved with `reviewStatus: needs_revision`,
`approvable: false`, and the failed checks listed as review issues so the owner
can edit and approve it. Checks marked `advisory` only lower the score.

## Commercial policy

The saved policy controls commercial content:

- `fields_only` — never put price, rate, budget, timeline, deadline, or delivery
  in the proposal body. They belong in the bid fields.
- `if_client_asks` — include them only when the client asked.
- `body_when_set` — include the chosen bid amount and delivery when available.

Job JSON is sanitized for the writer when commercial terms are forbidden. A
failed review or unavailable review model makes the draft require approval; it
does not auto-bid.

## Profile setup checklist

The highest-leverage improvement is profile data, not prompt wording.

1. **Title**: a real role, e.g. "Full Stack Developer", not a person's name.
2. **About**: 3–6 concrete sentences with your stack and the problems you solve.
   Avoid a wall of marketing adjectives.
3. **Portfolio summary**: markdown with 2+ projects, what you built, and the
   outcome. Add a URL only if it is public. The pipeline selects the relevant
   sections; the full portfolio is not dumped into the writer prompt.
4. **Voice samples**: real proposals you wrote. They teach the voice stage, not
   the writer directly. Mark genuinely strong prose as `preferred`; imported
   bids start inactive and low-rated so they are reviewed before use. A won bid
   is not automatically a good writing sample.
5. **Proposal writer instructions**: editable and owned by you. Clearing a field
   removes that instruction; no hidden default is restored.
6. **Your proposal instructions**: tone and boundaries, not facts. Use this for
   rules such as "do not quote price or delivery".

## Prompt and config versioning

Saved configs are not silently overwritten. New installs seed the current
defaults. Existing installs show an **Upgrade defaults** action in the Proposal
System page.

The upgrade replaces only values that still match the shipped fingerprints.
Customized prompts, contracts, candidate lanes, custom flow steps, context files,
policy, checks, and engine settings are preserved. New contract and flow fields
are filled with shipped defaults when an older config is loaded. A full reset
restores all defaults and discards customization.

## Evaluation

The eval uses the saved profile, saved OpenRouter key, saved proposal model, and
the real production pipeline. It makes real OpenRouter calls and spends real
credits. It does **not** insert proposals into the database.

From `apps/server`:

```powershell
pnpm proposals:eval
```

To test a different model without changing the saved selection:

```powershell
pnpm proposals:eval --model=openai/gpt-4o-mini
```

To run matching fixtures:

```powershell
pnpm proposals:eval --only=wordpress
```

The script prints each proposal, deterministic score, checks, warnings, review
status, coverage, and the competitor note.

Fixtures live in `apps/server/tests/fixtures/proposal-eval-jobs.json`. Keep client
names generic and never put real client data or secrets in the fixture file.

## Reading the results

For each proposal ask:

1. Does the first sentence name this client's actual problem or decision?
2. Is the proof real and relevant, or a skill dump?
3. Does the plan explain why the key step matters?
4. Are dependencies, acceptance criteria, and risks handled honestly?
5. If price or delivery is included, does it match the chosen bid exactly?
6. Is every deliverable covered without padding?
7. Would this stand out among 20 similar proposals?

Treat the deterministic score as a floor. A 100/100 proposal can still be bland.

## Known limitations

- The client is shown as a label such as "Client in Germany", not a person's name.
- Currency display is USD-oriented in the bid form and prompt.
- An empty portfolio cannot be papered over. The writer is told to omit proof
  rather than invent it.
- Deterministic coverage uses token matching and can miss unusual paraphrases; a
  human still decides whether the draft is actually complete.
- The judge and reviewer are model-based. Failures require human approval rather
  than silently approving the draft.

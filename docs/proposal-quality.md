# Proposal Quality Playbook

This document defines what a good proposal looks like in this app and how to test
the generator. It is meant to be used together with the in-app Profile page and
the proposal model selected on the Platforms page.

## Why proposals can feel generic

The generator may only use verified profile facts. It cannot invent experience,
clients, certifications, or portfolio work. When `userSummary` and
`portfolioSummary` are empty, the proposal can only lean on `About`, `Skills`,
and the job description, which makes it sound thinner.

The other common causes are:

- A small/fast model is selected for proposals. Proposal writing needs a stronger
  model than screening does.
- No bid amount or delivery time was passed to the model. Before the October 2026
  prompt update, the model sometimes invented a price or deadline. Now it is told
  to omit them when they are not chosen.
- The profile `Title` or `About` is imported incorrectly or not filled in.
- Custom instructions or templates contain generic filler such as "I am the
  perfect fit" or ask for claims the profile cannot support.

## What the generator does

- Sends the profile's **Proposal writer instructions** first, then the verified
  profile facts, portfolio, templates, and job details. **Your proposal
  instructions** are appended last. There are no built-in writing rules layered
  on top of those saved instructions.
- The Profile page exposes both writer fields as editable text. Clearing either
  field removes that instruction for real; it does not restore a hidden default.
- Passes the exact bid amount and delivery time as data. If a value is mentioned
  in the proposal, it must match the bid exactly. Omitting a value is allowed.
- Passes the budget range, bid counts, analysis, and competitor data only as
  internal context and treats them as non-client-facing.
- Keeps a small safety floor: a draft under 40 words is treated as truncated.
- Rejects drafts that invent a price, contradict a chosen delivery time, leak
  competitor/bid stats, contain placeholders, or cite unverified links.
- Retries once with the failed checks when a safety check fails. Style, length,
  commercial inclusion, and closing preferences are not re-imposed during the
  retry.
- Builds one authoritative profile payload in the caller and passes it straight
  through. Regeneration and the eval script use the same full profile data,
  including the editable writer instructions.

## Quality rubric

The deterministic checker is in
`apps/server/src/lib/proposal-quality.ts`. It is a fast first pass, not a
replacement for reading the proposal.

| Check | What it verifies |
| --- | --- |
| Length | 120–170 words |
| Specific | At least 3 terms from the job title, description, or skills |
| Plain | No headings, bullets, markdown, or code blocks |
| Price | If a price is mentioned, it matches the chosen bid amount; omission is allowed |
| Delivery | If a delivery time is mentioned, it matches the chosen time; omission is allowed |
| CTA | Reports whether the closing has a question or next step; not enforced |
| Competition | Does not expose competitor counts or bid statistics |
| Placeholder | No `[brackets]`, "your name", or lorem ipsum |
| Links | Only cites URLs found in the profile |
| Proof | References at least one profile skill |
| Warnings | Generic phrases, generic greetings, unverified results, and claimed job skills missing from the profile |

A score below 80 means the draft needs editing. A score of 100 only means the
mechanical checks passed; it still needs a human read.

## Profile setup checklist

The highest-leverage improvement is profile data, not prompt wording.

1. **Title**: a real role, e.g. "Full Stack Developer", not a person's name.
2. **Hourly rate**: set it so the model can talk about commercial terms.
3. **About**: 3–6 concrete sentences with your stack and the problems you solve.
   Avoid a wall of marketing adjectives.
4. **AI profile brief**: generated automatically from your saved facts. It is
   read-only in the UI, so it can never drift from the profile.
5. **Portfolio summary**: markdown with 2+ projects, what you built, and the
   outcome. Add a URL if it is public.
6. **Proposal writer instructions**: the editable system prompt and prepended
   writing instructions. These are the old built-in defaults, now owned by you.
   Edit them or clear them; nothing is re-added behind your back.
7. **Your proposal instructions**: appended after the rest of the prompt. State
   tone and boundaries, not facts. The model already has the facts. This is the
   right place to say "do not quote price or delivery" or "do not ask a question".
8. **Proposal templates**: optional. Use them for structure and voice only.

### Suggested custom instructions

```text
Write like a senior engineer talking directly to the client. Be specific and
calm. Do not flatter, do not use sales language, and do not repeat the job post.
Open with the client's problem, then give a short concrete plan. Ask one useful
question at the end. Never claim experience, clients, certifications, or results
that are not in my profile.
```

### Suggested template

Do not paste a full proposal that contains facts. Use a skeleton:

```text
[Opening: the client's problem in one sentence]
[Proof: 1–2 relevant skills or projects from the profile]
[Plan: 2–4 concrete steps tied to the job]
[Commercials: optional; if included, use the exact bid amount and delivery]
[Close: one specific question]
```

## Model selection

On the Platforms page, the **Proposal model** should be a stronger model than the
**Relevance model**. Screening is a short JSON classification; proposal writing is
long-form reasoning and writing.

If the selected proposal model is a small/fast model and the output is bland,
switch to a stronger model available in the catalogue and rerun the evaluation.
Do not change the relevance model unless screening quality also drops.

## Running the evaluation

The eval uses the saved profile, saved OpenRouter key, and saved proposal model.
It makes real OpenRouter calls and spends real credits. It does **not** insert
proposals into the database.

From `apps/server`:

```powershell
pnpm proposals:eval
```

To test a different model without changing the saved selection:

```powershell
pnpm proposals:eval --model=openai/gpt-4o-mini
```

To run one fixture instead of all three:

```powershell
pnpm proposals:eval --only=node
```

The script prints each generated proposal, the deterministic score, every check,
warnings, and the competitor note.

Fixtures live in `apps/server/tests/fixtures/proposal-eval-jobs.json`. They cover:

1. A fixed-price infrastructure diagnosis.
2. A fixed-price multi-tenant SaaS MVP.
3. An hourly Node.js/API performance fix.

Add fixtures when you find a job type that generates weak proposals. Keep client
names generic and never put real client data or secrets in the fixture file.

## Reading the results

For each proposal, ask:

1. Does the first sentence name the actual problem, not a generic greeting?
2. Is the proof point real and relevant, or is it a skill dump?
3. Is the plan specific enough that another engineer could start?
4. If price or delivery is included, does it match the bid exactly?
5. Does the closing follow your saved instructions?
6. Would this stand out among 20 similar proposals?

If the answer to 1, 3, or 6 is no, edit the writer instructions. If 2 or 5 is no,
the profile or your proposal instructions usually need work.

## Previous local evaluation

On 2026-10-20, before the writer instructions became editable, the three fixtures
were run against the saved profile and proposal model (`openai/gpt-oss-20b`).
Results under that older hardcoded prompt:

- All three passed the deterministic checks (100/100; 92–127 words).
- The exact bid amount and delivery time appeared in every proposal.
- The budget range, competitor counts, and analysis bid were not mentioned.
- One run returned an empty response when a 700-token `max_tokens` cap was set.
  The cap was removed because reasoning models can spend the whole budget on
  hidden reasoning. Do not add a small cap back without testing this model.

Those results no longer describe the current generator, which follows the saved
profile instructions. Rerun the evaluation after editing them.

Treat the deterministic score as a floor. A 100/100 proposal can still be bland;
read it and judge the specificity of the plan and proof points.

## Known limitations

- The client is shown as a label such as "Client in Germany", not a person's
  name, so proposals cannot personalize with a name.
- Currency display is USD-oriented in the bid form and prompt.
- An empty `userSummary` and `portfolioSummary` cannot be papered over. The model
  is instructed to omit proof points rather than invent them.
- The deterministic checker does not judge writing quality or factual truth
  beyond the constraints listed above.

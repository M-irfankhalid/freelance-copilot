# Product Requirements Document

## Product

Freelance Copilot

## Description

A self hosted, open source AI agent that helps individual freelancers find and win Freelancer.com projects.

## Goal

Help a freelancer win more clients by automating job discovery, analysis, matching, and proposal writing, while keeping the human in control of every bid unless they explicitly hand that control over.

## Target User

Individual freelancers.

One installation serves exactly one user.

## Core Workflow

Register → Configure credentials → Import profile → Set preferences

→ Worker polls jobs → Relevancy filter → AI analysis → Proposal draft

→ User review (or auto-bid) → Submit bid → Track results

## Main Navigation

Dashboard

WORK

• Jobs
• Matches
• Proposals
• Bids

INSIGHTS

• Analytics
• Logs

MANAGE

• Platforms
• Automation
• Profile
• Settings

## Authentication

• Email and password registration and login.
• Passwords are hashed.
• Cookie sessions.
• At registration the app generates one-time backup codes, shown once.
• Backup codes restore access if the user forgets their password.
• The first registered account owns the installation.
• Single user. No teams, no organizations.

Simple auth for now. Two factor authentication is future work.

## Onboarding

After the first login the user is walked through setup once:

1. Add Freelancer.com access token. A test button makes one lightweight real API call to verify it.
2. Add OpenRouter API key. A test button verifies the key.
3. Import profile from Freelancer.com with one click, then enrich manually.
4. Set keywords, wants, not-wants, and custom AI instructions.
5. Set the job scan interval.

Onboarding state is tracked so returning users land on the dashboard. Every step can also be completed or redone later from its own page.

## Platforms, BYOC

Bring Your Own Credentials. Initially supported:

• Freelancer.com — personal access token.
• OpenRouter — API key, with user selected AI model.

Rules:

• Credentials are encrypted before database storage.
• Credentials are never returned to the frontend after saving, never logged.
• Each platform has a test action performing one minimal real API call.
• Model selection: user picks from OpenRouter models; choice is stored.
• Where an API exposes usage or rate limit information, the app displays it, such as remaining Freelancer.com request quota and OpenRouter credit usage, on Platforms and the Dashboard.

## Profile

Everything the agent is allowed to know about the user lives here:

• Name, title, hourly rate, about.
• Skills, also used as job search keywords.
• Experience, portfolio, certifications.
• Preferred project types.
• Wants and not-wants, the job relevancy filters.
• Custom AI instructions, free form commands the agent must follow when drafting.

Import from Freelancer.com: one button fetches the user's own profile data from Freelancer.com, shows it, and prefills the form. The user can always add or correct more data manually.

The AI may only use facts present in this profile. It must never invent skills, experience, portfolio items, certifications, or client history.

## Jobs

Discovery:

• A background worker scans Freelancer.com using the profile skills and keywords.
• The scan runs on a user set interval. Default 60 seconds, minimum 30 seconds.
• Fetched jobs are stored and deduplicated by project ID.
• Manual add: pasting a job URL or job ID fetches and stores that specific job for review.

Viewing:

• Job list with budget, skills, posting time, and match score.
• Job detail renders like Freelancer.com itself: full description, budget, skills, client information, attachments.
• Bid insights on job detail are cached, showing updated X time ago. A refresh button triggers one fresh API call on demand. Insights are never refetched on every page view.
• Competitor box: AI summary of aggregate bid statistics, bid count, average and top bid. Important: the Freelancer.com API does not expose other bidders' proposal texts. Reading actual competing proposals would require public page scraping, which is a separate future feature.

## Matching

• Before AI analysis, a cheap relevancy filter applies the user's wants, not-wants, and keywords.
• Relevant jobs get AI analysis: match score, matching skills, missing skills, project concerns, explanation.
• Users can ignore matches.

## Proposals

• Drafted strictly from user profile facts plus job details plus optional bid statistic context.
• Users can edit, save, regenerate, and approve proposals.
• Approved proposals move to bid submission.

## Bidding

Manual path, always available:

• Review bid amount and proposal, submit, track status and result.

Auto-bid path, opt-in and disabled by default:

• Requires explicit activation by the user.
• Configured with safety limits: minimum match score, minimum and maximum bid amounts, daily bid cap.
• When enabled and a job passes the score threshold, the agent picks an amount inside the min and max bounds and submits without user review.
• Every auto-bid decision is logged.
• Automation pauses when the daily cap is reached or on repeated errors, and can be paused or resumed at any time.

## Automation

Users control:

• Scan interval, minimum 30 seconds, default 60 seconds.
• Automatic analysis, matching, and proposal generation toggles.
• Auto-bid activation with thresholds, bounds, and caps.

Worker pipeline:

Poll → Deduplicate → Relevancy filter → Analyze → Draft → Approval queue or auto-bid → Log

## Logs

• A dedicated Logs page.
• The system logs every meaningful event: scans, deduplication results, API calls without secrets, relevancy outcomes, analyses, drafts, approvals, submissions, auto-bids, errors.
• Newest first, searchable, filtered by level and category.

## Dashboard

Show:

• Jobs found
• Matches
• Proposals
• Bids
• Won projects
• Recent activity
• Worker and automation status
• Platform connection health and quota usage

## Analytics

Basic only:

• Jobs analyzed, matches, proposals, bids, won projects, success rate, average bid.

## MVP

The MVP is complete when the user can:

1. Register and receive backup codes.
2. Log in.
3. Complete onboarding, adding and testing both credentials.
4. Import or manually enter their profile.
5. Set keywords, filters, AI instructions, and scan interval.
6. Watch polled jobs arrive.
7. Add a specific job manually by URL or ID.
8. See matches with scores and reasons.
9. Generate, edit, and approve a proposal.
10. Submit a bid manually and track it.
11. Enable auto-bid and observe it bid within bounds and log each action.
12. Open the Logs page and see everything that happened.

## Security

• Passwords are hashed.
• API credentials are encrypted at rest.
• Secrets are never logged.
• Secrets are never exposed to the frontend.
• Secrets are never committed to Git.

## Privacy

The application is self hosted.

User data stays on the user's server except when information is intentionally sent to external services, namely Freelancer.com and OpenRouter.

## Out of Scope

Do not initially build:

• Multi user support
• Teams
• Organizations
• Billing
• SaaS subscriptions
• Mobile apps
• Multiple freelancing platforms
• Microservices
• Kubernetes
• Advanced analytics
• Autonomous bidding without explicit activation and safety limits
• Scraping competing proposals from public pages, deferred as a separate future decision due to terms of service risk

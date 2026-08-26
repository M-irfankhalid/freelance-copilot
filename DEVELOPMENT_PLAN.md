# Development Plan

## Goal

Build a self hosted AI agent that helps an individual freelancer find, analyze, match, and bid on Freelancer.com projects, and ultimately win more clients.

The application is designed for a single user and will be open source.

Users bring their own Freelancer.com token and OpenRouter API key.

## Phase 1, Frontend

Build the complete application UI using React + Vite with mock data only.

### Application Shell

• Sidebar navigation
• Header
• Responsive layout
• User account menu
• Loading states
• Empty states
• Error states

### Pages

• Dashboard
• Jobs, including job detail rendered like Freelancer.com with an AI suggestion box and a cached bid insights card showing updated time ago plus refresh button
• Matches
• Proposals, including the approval queue
• Bids
• Analytics
• Logs
• Platforms, including credential test buttons and usage display
• Automation, including scan interval setting and auto-bid configuration
• Profile, including profile import from Freelancer.com and manual enrichment
• Settings
• Login and Signup, including the backup codes shown once after registration
• Onboarding wizard, credentials, test actions, import profile, preferences

### Components

• Cards
• Tables
• Forms
• Buttons
• Dialogs
• Dropdowns
• Badges
• Tabs
• Navigation
• Notifications

Use mock data where necessary.

The frontend should be functional visually, but does not need a real backend yet.

Do not implement authentication logic, database logic, real AI calls, Freelancer.com integration, or automation in this phase. Buttons that trigger backend actions render their intended behavior against mock data.

## Phase 2, Backend Foundation

Build the backend required by the frontend.

• Express
• TypeScript with strict tsconfig
• API structure as a modular monolith
• SQLite with Drizzle ORM
• Environment configuration
• Central error handling
• Request validation with Zod
• Structured logging foundation feeding the Logs page later

Do not introduce microservices or extra infrastructure.

## Phase 3, Frontend and Backend Integration

Connect the frontend to the backend.

• API client
• API error handling
• Loading states
• Authentication state
• Protected routes
• Replace mock data with API data page by page

The frontend should now communicate with the real backend.

## Phase 4, Authentication

Build local authentication for a single user.

• Signup generating one-time backup recovery codes, displayed once
• Login, logout
• Password hashing
• Sessions
• Protected routes
• Backup code recovery path when the password is forgotten
• First account owns the installation; further registrations are refused

No teams or organizations.

## Phase 5, Platform Credentials

Build the Platforms page backend.

• Store Freelancer.com access token encrypted at rest
• Store OpenRouter API key encrypted at rest
• Store selected OpenRouter model
• Test action for Freelancer token performing one lightweight real API call
• Test action for OpenRouter key
• Never expose stored credentials to the frontend after saving
• Never log credentials
• Surface rate limit or credit information where APIs provide it

## Phase 6, Profile

Build the profile used to ground all AI output.

• Fetch own profile data from Freelancer.com and prefill the form
• Manual editing and enrichment of all fields
• Skills doubling as search keywords
• Wants and not-wants relevancy filters
• Custom AI instructions
• Validation of imported data before storage

The AI may only use facts present in this profile.

## Phase 7, Freelancer.com Jobs

Connect to Freelancer.com.

• Freelancer.com API client
• Search jobs using profile skills and keywords
• Fetch a single job by ID or URL for manual add
• Store jobs deduplicated by project ID
• Job list and job detail endpoints
• Bid statistics retrieval for the cached bid insights card, storing refreshed at timestamps
• Rate limit awareness using quota information returned by the API

## Phase 8, AI Analysis and Matching

Add OpenRouter.

• OpenRouter client honoring the user selected model
• Relevancy filter applying wants, not-wants, and keywords before any AI call
• AI analysis of job requirements, skills, concerns
• Match score with reasons
• Store analysis
• Ignore match

AI generated output must be validated before use by application logic.

## Phase 9, Proposals

Build proposal generation.

• Generate proposal grounded only in user profile facts, job details, and optional bid statistic context
• Optional competitor box summarizing aggregate bid statistics, never invented proposal texts
• Edit, save, regenerate
• Approval queue state machine: draft, awaiting approval, approved, submitted

## Phase 10, Bidding

Build bidding.

• Review bid screen with amount and proposal
• Submit bid manually
• Bid history, status, result tracking
• Auto-bid engine, disabled by default:
  • Requires explicit activation
  • Minimum match score threshold
  • Minimum and maximum bid amounts, AI chooses within bounds per job
  • Daily bid cap with pause on reaching it
  • Every auto-bid decision logged
  • Pause and resume controls

## Phase 11, Project Files

Add project file analysis.

Support common formats such as:

• ZIP
• PDF
• DOCX
• TXT
• Markdown
• Source code
• Images

Flow:

Download → Extract → Inspect → Read → Analyze

Do not send unnecessary files to the AI.

## Phase 12, Automation Worker and Logs

Add controlled automation.

• Scheduled polling worker running at the user set interval, minimum 30 seconds, default 60 seconds
• Pipeline orchestration: poll, deduplicate, relevancy filter, analyze, draft, queue for approval or auto-bid
• Automation settings persisted server side
• Pause conditions: daily cap reached, repeated errors, credentials invalid
• Activity and system logs written for every pipeline step
• Logs page backend with search and level and category filters

Automatic bidding remains behind its explicit activation and safety limits.

## Phase 13, Analytics

Add basic analytics.

• Jobs analyzed, matches, proposals, bids, won projects
• Success rate, average bid
• Keep analytics simple

## Future

Possible future features, do not implement until the core product works:

• Scraping public job pages for competing proposal texts, separate terms of service review required
• Public client intelligence
• Additional freelancing platforms
• Additional AI providers beyond OpenRouter
• Two factor authentication
• Advanced automation

## Development Rules

1. Complete phases in order.
2. Work only on the current phase.
3. Do not build future functionality prematurely.
4. Keep the architecture simple.
5. Use a modular monolith.
6. Do not introduce microservices without a real requirement.
7. Do not add Redis or other infrastructure without a real requirement.
8. Use mock data during frontend development.
9. Replace mock data with real APIs during integration.
10. Test each phase before moving forward.
11. Keep the application self hosted.
12. Keep the application designed for a single user.
13. The AI must never invent user facts, skills, experience, or client history.
14. Automatic bidding stays disabled by default and always bounded by configured limits.

## Current Phase

Phase 1, Frontend

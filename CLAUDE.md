# Freelancer Agent

## Project

Freelancer Agent is a self hosted, open source AI agent for individual freelancers using Freelancer.com.

The application helps the user:

1. Find jobs
2. Analyze jobs
3. Match jobs to their profile
4. Inspect project files
5. Generate proposals
6. Review proposals
7. Submit bids
8. Track bidding activity

The application uses a BYOC model, Bring Your Own Credentials.

Users provide their own:

• Freelancer.com credentials
• OpenRouter API key, with a user selected model

## Architecture

Use a simple modular monolith.

Frontend:

React
Vite
TypeScript

Backend:

Node.js
Express
TypeScript

Database:

SQLite
Drizzle ORM

Other:

Zod
Docker
Docker Compose
pnpm

Do not introduce microservices unless explicitly required.

Do not add unnecessary infrastructure.

## Product

The application is designed for one user per installation.

It is self hosted and open source.

The user's data and credentials should remain on their own server.

## Security

User passwords must be hashed.

Freelancer.com credentials and OpenAI API keys must be encrypted at rest.

Never expose secrets to the frontend.

Never log secrets.

Never hardcode credentials.

Never commit secrets to Git.

## AI

The AI must not invent:

• Skills
• Experience
• Portfolio projects
• Certifications
• Previous work
• Client history

AI generated output must be validated before being used by application logic.

## Agent Behavior

The agent assists the user.

Automatic bidding must be disabled by default.

Enabling it requires explicit user activation plus configured safety limits:
a minimum match score, minimum and maximum bid amounts, and a daily bid cap.

The agent must not perform important external actions without the required user permission.

## Development

Read DEVELOPMENT_PLAN.md before starting development.

Work on the current phase only.

Do not implement future phases unless explicitly instructed.

Prefer the simplest working solution.

Do not rewrite working code unnecessarily.

Run relevant tests and checks after changes.
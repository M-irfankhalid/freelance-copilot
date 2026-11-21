# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on this repository instead:

1. Open the **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected version or commit, reproduction steps, and impact.

You will get a response as soon as the report has been reviewed.

## Scope

Freelance Copilot is a single-user, self-hosted application. The owner runs it
on their own machine or server and holds the only account.

Deliberate design decisions:

- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
  There is no separate CSRF token because the API is same-origin and the app
  has one user.
- There is no per-IP rate limiting. Put the app behind your own reverse proxy
  if it is exposed to the public internet.
- Platform credentials are encrypted at rest with `ENCRYPTION_KEY`. Losing that
  key makes saved credentials unreadable; leaking it gives access to them.
- The MCP write tools are opt-in and can be disabled with
  `MCP_ALLOW_WRITES=false`.

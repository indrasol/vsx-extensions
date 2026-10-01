# ADR 0013 — Metrics and lead capture run outside the public repository

- **Status:** Accepted
- **Date:** 2026-09-30
- **Supersedes in part:** ADR-0007 (where the collector and dashboard live and how collection is scheduled)

## Context

ADR-0007 placed a metrics `collector/` and an internal `dashboard/` in this repository, run by a
GitHub Actions cron. Since then the scope has grown to include a small public site that serves the
short links extensions open and a form for people who want to talk to Indrasol. That site, the
dashboard and the collector handle operational data (link clicks, form submissions, registry and
repository statistics) and deployment configuration that do not belong in a public extensions
repository. Keeping them here would also add credentials and scheduling concerns to a repository
whose CI is meant to build, test and publish extensions only.

## Decision

- The metrics collector, the internal dashboard and the lead-capture site live in Indrasol's
  private planning repository, not here.
- Collection runs as scheduled Supabase Edge Functions (pg_cron + pg_net); the public site and the
  dashboard are hosted on Netlify.
- Extensions link only to first-party short links on `labs.indrasol.com`, and a link is opened only
  when the user clicks it. The short link records the click (no IP address, cookie or user-agent
  string) and redirects.
- Extensions send no telemetry. ADR-0006 still governs any future opt-in telemetry.
- The public site stores no personal data without explicit consent: a form submission is kept only
  when the person ticks a consent box that links to the privacy page.
- The empty `collector/` and `dashboard/` placeholders and their workspace entries are removed.

## Alternatives considered

- Keep everything here as ADR-0007 described: transparent, but it puts operational data handling,
  deployment configuration and service credentials next to public extension code.
- A third repository just for metrics: clean separation, but one more repository to secure and
  maintain for a small amount of code.

## Consequences

This repository builds, tests and publishes extensions only; it holds no metrics code and no
service credentials for metrics. The data-handling principles above are public here and binding on
the private implementation. The parts of ADR-0007 about the data sources, Supabase, Netlify and
Entra sign-in still apply; only the location and the scheduler change.

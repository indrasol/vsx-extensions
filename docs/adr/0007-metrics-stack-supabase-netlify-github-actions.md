# ADR 0007 — Metrics stack: GitHub Actions cron → Supabase Postgres → Vite/React on Netlify

- **Status:** Accepted
- **Date:** 2026-09-27

## Context

We need one internal dashboard of installs, ratings, GitHub activity and (later) usage,
at zero cash cost, maintained by the same people and agent that maintain the extensions.

## Decision

A daily GitHub Actions cron runs `collector/` (Node/TS) which reads the Marketplace gallery
API, the Open VSX API and the GitHub API and upserts daily snapshots into a Supabase Free
project. The `dashboard/` (Vite + React) deploys to Netlify Free, reads via the anon key,
and sign-in uses Supabase Auth with the Azure (Entra) provider; row-level security allows
`select` only to `@indrasol.com` JWTs. The service-role key exists only as a GitHub secret.

## Alternatives considered

- Supabase `pg_cron` + Edge Function for collection: also free; but keeps logic outside the
  repo's TypeScript and is harder to run locally. Acceptable fallback.
- Grafana Cloud / Metabase: heavier, another login; revisit if the dashboard outgrows one page.
- Google Sheets: quick, but no auth story and poor for time series.

## Consequences

Supabase Free pauses inactive projects after 7 days; the daily cron prevents that. The
Marketplace gallery API is undocumented, so the collector must fail soft and alert.

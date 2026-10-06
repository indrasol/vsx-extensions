# ADR 0006 — Telemetry is anonymous, goes through labs-core, and follows the VS Code telemetry setting

- **Status:** Superseded (2026-10-05): telemetry removed
- **Date:** 2026-09-27

> **Note (2026-10-05):** Telemetry was removed. The labs-core telemetry module, its wiring in every
> extension and the template, `telemetry.json` and the per-install id are gone, and no extension
> collects anything. Any future measurement needs a new ADR; this one is kept as a record.

## Context

Registry install counts are cumulative and say nothing about active use. We want active
users, feature usage and host-app split, without collecting anything personal, and without
undermining the "local-first, privacy-first" principle.

## Decision

No extension ships telemetry in v1. When added (dashboard v2), it goes only through
`packages/labs-core`, built on `vscode.env.createTelemetryLogger()` so VS Code's own
`telemetry.telemetryLevel` setting is honoured automatically; the sender also checks
`isTelemetryEnabled` and `onDidChangeTelemetryEnabled`. Events are limited to `activated`,
`command_executed`, `feature_used`, `error` (class only) plus versions, host app name and a
random per-install UUID. No machine id, no paths, no code, no messages. Every event is listed
in the extension's `telemetry.json` and README, with the off switch documented.

## Alternatives considered

- Third-party analytics SDKs (Application Insights, PostHog): more data, more risk and weight.
- No telemetry ever: simpler, but leaves the G5 invest/archive decision to install counts alone.

## Consequences

The privacy policy at indrasol.com/labs/privacy must exist before any telemetry ships.
The ingest endpoint must reject payloads containing path-like strings.

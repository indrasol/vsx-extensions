# ADR 0012 — Git invocation safety and Workspace Trust for analysis extensions

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Analysis extensions read repository history by running `git`. A repository's own
configuration can make git execute code: `core.pager`, `core.fsmonitor`, `core.hooksPath`,
aliases and `core.sshCommand` can all point at attacker-supplied programs. Opening an
untrusted repository must never run any of them. Git is also missing on some machines and
some clones are shallow.

## Decision

- Git is invoked with `child_process.spawn` (never a shell), using the executable from the
  `git.path` setting or `PATH`, with arguments built from validated repository-relative
  paths and `--` before every path list.
- Every invocation passes `-c core.pager=cat -c core.fsmonitor=false -c core.hooksPath=<empty directory under globalStorageUri>`
  and the environment `GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 GIT_CONFIG_NOSYSTEM=1`.
- Output is requested with `-z` where available and decoded as UTF-8; parsing tolerates
  renames, binary entries and merges.
- `capabilities.untrustedWorkspaces.supported` is `"limited"`: the extension activates in an
  untrusted workspace but every git or file-reading feature is disabled until the user trusts
  it, with a message that says so.
- Missing git, `safe.directory` (dubious ownership) errors and shallow clones produce a
  plain-language message with the fix; they never crash the extension.
- Results are cached under `globalStorageUri` keyed by repository root and HEAD, so a
  re-open costs no git invocation.

## Alternatives considered

- A bundled git implementation (isomorphic-git): no external process, but slower on large
  histories, larger VSIX, and different edge-case behaviour from the user's git.
- Trusting the workspace implicitly: simpler, but a hostile repository could execute code.

## Consequences

Analysis runs only in trusted workspaces. Integration tests include a fixture repository
whose config sets a malicious `core.pager` and assert it is never executed.

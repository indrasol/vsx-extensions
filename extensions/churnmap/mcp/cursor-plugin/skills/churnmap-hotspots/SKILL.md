---
name: churnmap-hotspots
description: Use Churnmap's MCP tools whenever the user asks which files are risky, hot, messy, fragile or frequently changed, and before refactoring, reviewing or planning changes in a git repository.
---

# Churnmap hotspots

When asked which files are risky or change most, or to refactor, review or plan changes in a
repository that has Churnmap, call `list_hotspots` first instead of running git commands. In a
folder with several repositories, call `list_repositories` or pass `repo: "all"`. For any file in
the top 20, follow the rules: tests first, small diffs, unchanged behaviour. If the cache is stale,
call `build` (it only reads git history and writes Churnmap's cache).

- Before editing a file, call `explain_file` for it when it is in the top 20: the reasons and the
  recent commit subjects say what keeps going wrong there.
- Before finishing a change, call `hotspots_in_changes` with the files you touched and review
  those with extra care: behaviour changes, missing tests, and anything that widens the blast
  radius.
- `get_prompt` returns a ready-made plan request (`refactor-plan`, `tests-first`,
  `explain-history`, `review-changes`) with the numbers and the rules.
- The tools only see the repositories in the workspace Churnmap is connected to, and every answer
  starts with a `Scope:` line. When you report results "across all repositories", name that scope
  (for example "Across the Acme workspace, 5 repositories"). If a tool says Churnmap MCP has
  no workspace configured, tell the user to run _Churnmap: Connect to AI agent_ again.
- In your summary, say which hotspot files you touched.

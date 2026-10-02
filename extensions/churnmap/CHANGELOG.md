# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1]

### Changed

- README: Indrasol Labs section updated; homepage now points to the Churnmap page.

## [1.0.0]

Initial release.

### Added

- **Your repository as a city.** Folders are districts and files are buildings: height is lines of
  code, colour is the relative band (Hotspot = the top 5 % of your code files, Watch = the next
  15 %, Stable = the rest, so #1 is always a Hotspot), and the top 20 glow. Files that are not
  ranked are drawn as grey glass with the reason on their card.
- **Hotspots, ranked and explained.** Each file is scored from its git history on relative churn,
  change frequency, nesting depth, author spread and bug-fix commits, with the two or three
  reasons as plain sentences ("Rewritten about 2× in 90 days", "Changed 29 times in 90 days") and
  the numbers behind them, and whether its complexity is rising or falling. _How is this scored?_
  on the card and the legend explains the score with the file's own numbers.
- **30, 90 or 365 days of history**, switched in place; the buildings morph to their new heights.
- **Hover cards** with a risk meter, reasons, a facts row (lines · people · complexity trend) and a
  weekly-commits sparkline. A click selects a building and keeps its card open with **Open file**
  and **✦ AI prompt**; a double-click or `Enter` opens the file. Cards, the "Needs attention" rail
  and the legend can be moved, collapsed and closed, and remember their place per workspace.
- **Move around freely**: orbit, pan and zoom with mouse, trackpad or keyboard; **⤢ Fit** frames
  the whole city. The top-5 name pills never cover each other or a panel.
- **2D treemap** of the same layout, with a smooth 3D ↔ 2D morph (`2` key or the top bar).
- **Hotspots view** in the side bar: the top 20 with score, trend, owners and reasons; open, show
  in city, ignore, and copy the list as Markdown.
- **Ignore with a reason** for 90 days, with Undo and _Un-ignore hotspot…_; ignored files stay in
  the city.
- **Status-bar rank** for the file you are editing, and a quiet warning when your changes touch a
  hotspot.
- **Postcard export**: a 1600×900 PNG of the city and the top three, naming as much as you choose
  (paths, folders only or nothing), saved only where you pick. It never contains source code.
- **AI-ready.** **✦ AI prompt** on any hotspot writes a ready-to-paste prompt for your own AI agent
  that you review before you copy or send it. _Export for agents_ writes `.churnmap/HOTSPOTS.md`
  and `hotspots.json`, refreshed on every build. A local MCP server (`list_hotspots`,
  `explain_file`, `hotspots_in_changes`, `get_prompt`, `list_repositories`, `build`; every tool
  but `build` read-only) ships in the extension and sees only your workspace; _Connect to AI
  agent…_ sets it up for Cursor, Claude Code or VS Code.
- **Repository picker** for nested and multi-root workspaces; source code ranks by default
  (`churnmap.rank`), with a friendly message for repositories that are mostly documentation.
- **Instant reopen**: a cached analysis for the current commit fills everything in without running
  git.
- **Accessible**: keyboard orbit and a focusable ranked list, screen-reader announcements, a
  high-contrast palette and reduced motion.
- **Get started walkthrough**, and a _More from Indrasol Labs_ view.
- **Private by design**: no telemetry, no network calls, analysis only in trusted workspaces, git
  run with repository-controlled programs switched off, and a strict Content Security Policy for
  the city. `ThirdPartyNotices.txt` lists every bundled library with its licence text.

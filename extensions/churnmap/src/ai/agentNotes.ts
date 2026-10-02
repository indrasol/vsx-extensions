/**
 * The block Churnmap adds to an agent's notes file (AGENTS.md, CLAUDE.md, a Cursor rule, Copilot
 * instructions): three lines pointing at `.churnmap/HOTSPOTS.md`, between markers so it is
 * replaced, never duplicated. Pure; the file I/O is in `writers.ts`.
 */

export const BLOCK_START = '<!-- churnmap:start -->';
export const BLOCK_END = '<!-- churnmap:end -->';

export const NOTES_BLOCK = [
  BLOCK_START,
  '## Code hotspots (Churnmap)',
  'Before editing any file listed in `.churnmap/HOTSPOTS.md`, read that file. For those files: add or update tests first,',
  'keep diffs small and behaviour unchanged, and say in your summary which hotspot you touched.',
  BLOCK_END,
].join('\n');

/** The extra line *Connect to AI agent…* adds, so the agent calls the MCP tools, not git. */
export const MCP_LINE =
  'For questions about hotspots, risky or frequently changed files, call the `churnmap` MCP tools (`list_hotspots`, `explain_file`) instead of running git commands.';

/** The block with the MCP line before its end marker. */
export const NOTES_BLOCK_WITH_MCP = NOTES_BLOCK.replace(BLOCK_END, `${MCP_LINE}\n${BLOCK_END}`);

/** The notes files Churnmap offers to update, repository-relative. */
export const AGENT_NOTES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursor/rules/churnmap.mdc',
  '.github/copilot-instructions.md',
] as const;

export type AgentNote = (typeof AGENT_NOTES)[number];

export function isAgentNote(x: unknown): x is AgentNote {
  return typeof x === 'string' && (AGENT_NOTES as readonly string[]).includes(x);
}

/** Cursor rule front matter: the rule applies to every request. */
export const MDC_FRONT_MATTER = [
  '---',
  'description: Code hotspots from Churnmap',
  'alwaysApply: true',
  '---',
].join('\n');

const BLOCK = /<!-- churnmap:start -->[\s\S]*?<!-- churnmap:end -->/;

/**
 * `existing` (undefined when the file does not exist) with the block added or replaced. A `.mdc`
 * file gets Cursor front matter when it has none. Applying it twice gives the same text. With
 * `mcp` (or when the existing block already has it) the block carries `MCP_LINE`, so a later
 * *Export for agents* never drops what *Connect to AI agent…* added.
 */
export function upsertNotesBlock(
  existing: string | undefined,
  file: string,
  opts: { mcp?: boolean } = {},
): string {
  const mdc = file.endsWith('.mdc');
  let text = existing ?? '';
  const current = BLOCK.exec(text)?.[0];
  const block =
    opts.mcp === true || current?.includes(MCP_LINE) === true ? NOTES_BLOCK_WITH_MCP : NOTES_BLOCK;
  if (current !== undefined) {
    text = text.replace(BLOCK, block);
  } else {
    const trimmed = text.replace(/\s+$/, '');
    text = trimmed === '' ? `${block}\n` : `${trimmed}\n\n${block}\n`;
  }
  if (mdc && !text.startsWith('---\n')) text = `${MDC_FRONT_MATTER}\n\n${text}`;
  return text;
}

/** True when `.gitignore` text already ignores the `.churnmap/` folder. */
export function ignoresContextDir(gitignore: string): boolean {
  return gitignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some(
      (l) => l === '.churnmap' || l === '.churnmap/' || l === '/.churnmap' || l === '/.churnmap/',
    );
}

/** `.gitignore` with `.churnmap/` appended (unchanged when it is already there). */
export function withContextDirIgnored(gitignore: string | undefined): string {
  const text = gitignore ?? '';
  if (ignoresContextDir(text)) return text;
  const trimmed = text.replace(/\s+$/, '');
  return trimmed === '' ? '.churnmap/\n' : `${trimmed}\n.churnmap/\n`;
}

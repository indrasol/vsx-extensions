import { describe, expect, it } from 'vitest';
import {
  AGENT_NOTES,
  BLOCK_END,
  BLOCK_START,
  ignoresContextDir,
  isAgentNote,
  MCP_LINE,
  MDC_FRONT_MATTER,
  NOTES_BLOCK,
  NOTES_BLOCK_WITH_MCP,
  upsertNotesBlock,
  withContextDirIgnored,
} from '../../../src/ai/agentNotes.js';

const count = (text: string, part: string): number => text.split(part).length - 1;

describe('upsertNotesBlock', () => {
  it('creates a file with just the block', () => {
    expect(upsertNotesBlock(undefined, 'AGENTS.md')).toBe(`${NOTES_BLOCK}\n`);
    expect(upsertNotesBlock('', 'CLAUDE.md')).toBe(`${NOTES_BLOCK}\n`);
  });

  it('appends after existing text, separated by a blank line', () => {
    expect(upsertNotesBlock('# Team notes\n\nBe nice.\n\n\n', 'AGENTS.md')).toBe(
      `# Team notes\n\nBe nice.\n\n${NOTES_BLOCK}\n`,
    );
  });

  it('replaces an existing block in place, keeping text on both sides', () => {
    const old = `# Notes\n\n${BLOCK_START}\nold words\n${BLOCK_END}\n\n## After\nkeep me\n`;
    const next = upsertNotesBlock(old, 'AGENTS.md');
    expect(next).toBe(`# Notes\n\n${NOTES_BLOCK}\n\n## After\nkeep me\n`);
  });

  it('is idempotent: applying it again changes nothing and never duplicates', () => {
    for (const note of AGENT_NOTES) {
      const once = upsertNotesBlock('intro\n', note);
      const twice = upsertNotesBlock(once, note);
      expect(twice).toBe(once);
      expect(count(twice, BLOCK_START)).toBe(1);
    }
  });

  it('gives a Cursor rule its front matter (alwaysApply) once', () => {
    const mdc = upsertNotesBlock(undefined, '.cursor/rules/churnmap.mdc');
    expect(mdc.startsWith(`${MDC_FRONT_MATTER}\n\n`)).toBe(true);
    expect(mdc).toContain('alwaysApply: true');
    expect(count(upsertNotesBlock(mdc, '.cursor/rules/churnmap.mdc'), 'alwaysApply')).toBe(1);
    // Markdown files never get front matter.
    expect(upsertNotesBlock(undefined, 'AGENTS.md')).not.toContain('alwaysApply');
  });

  it('points agents at .churnmap/HOTSPOTS.md in three lines between markers', () => {
    const lines = NOTES_BLOCK.split('\n');
    expect(lines[0]).toBe(BLOCK_START);
    expect(lines.at(-1)).toBe(BLOCK_END);
    expect(lines.slice(1, -1)).toHaveLength(3);
    expect(NOTES_BLOCK).toContain('`.churnmap/HOTSPOTS.md`');
  });
});

describe('agent notes list', () => {
  it('offers the four known files and nothing else', () => {
    expect(AGENT_NOTES).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      '.cursor/rules/churnmap.mdc',
      '.github/copilot-instructions.md',
    ]);
    expect(isAgentNote('AGENTS.md')).toBe(true);
    expect(isAgentNote('../etc/passwd')).toBe(false);
  });
});

describe('.gitignore', () => {
  it('recognises the folder in its usual spellings', () => {
    for (const line of ['.churnmap', '.churnmap/', '/.churnmap', ' /.churnmap/ ']) {
      expect(ignoresContextDir(`node_modules/\n${line}\r\n`)).toBe(true);
    }
    expect(ignoresContextDir('.churnmap-other/\n')).toBe(false);
  });

  it('appends once and creates when missing', () => {
    expect(withContextDirIgnored(undefined)).toBe('.churnmap/\n');
    expect(withContextDirIgnored('dist/')).toBe('dist/\n.churnmap/\n');
    const once = withContextDirIgnored('dist/\n');
    expect(withContextDirIgnored(once)).toBe(once);
  });
});

describe('the MCP line (Connect to AI agent)', () => {
  it('adds the line that sends the agent to the MCP tools instead of git', () => {
    expect(MCP_LINE).toBe(
      'For questions about hotspots, risky or frequently changed files, call the `churnmap` MCP tools (`list_hotspots`, `explain_file`) instead of running git commands.',
    );
    const rule = upsertNotesBlock(undefined, '.cursor/rules/churnmap.mdc', { mcp: true });
    expect(rule.startsWith(`${MDC_FRONT_MATTER}\n\n`)).toBe(true);
    expect(rule).toContain(NOTES_BLOCK_WITH_MCP);
    expect(NOTES_BLOCK_WITH_MCP.endsWith(`${MCP_LINE}\n${BLOCK_END}`)).toBe(true);
  });

  it('a later Export for agents keeps the line; applying twice changes nothing', () => {
    const connected = upsertNotesBlock('# Notes\n', 'CLAUDE.md', { mcp: true });
    const exported = upsertNotesBlock(connected, 'CLAUDE.md');
    expect(exported).toBe(connected);
    expect(count(exported, MCP_LINE)).toBe(1);
    expect(upsertNotesBlock(exported, 'CLAUDE.md', { mcp: true })).toBe(exported);
  });
});

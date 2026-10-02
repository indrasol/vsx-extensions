import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BLOCK_START } from '../../../src/ai/agentNotes.js';
import {
  contextFiles,
  existingAgentNotes,
  hasContextFiles,
  ignoreContextDir,
  updateAgentNote,
  writeContextFiles,
  writeText,
} from '../../../src/ai/writers.js';
import type { AgentNote } from '../../../src/ai/agentNotes.js';
import { analysis, fileScore } from './helpers.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cm-writers-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Every file under `dir`, relative, sorted. */
function tree(dir: string, prefix = ''): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? tree(dir, join(prefix, e.name))
        : [join(prefix, e.name).replace(/\\/g, '/')],
    )
    .sort();
}

describe('writeContextFiles', () => {
  it('writes exactly .churnmap/HOTSPOTS.md and .churnmap/hotspots.json, and overwrites them', async () => {
    const result = analysis([fileScore('src/a.ts', 90)], { repoRoot: root });
    expect(await hasContextFiles(root)).toBe(false);
    await writeContextFiles(result);
    expect(tree(root)).toEqual(['.churnmap/HOTSPOTS.md', '.churnmap/hotspots.json']);
    expect(await hasContextFiles(root)).toBe(true);
    const json = JSON.parse(readFileSync(contextFiles(root).json, 'utf8')) as { top: unknown[] };
    expect(json.top).toHaveLength(1);

    await writeContextFiles(
      analysis([fileScore('src/a.ts', 90), fileScore('src/b.ts', 80)], { repoRoot: root }),
    );
    const again = JSON.parse(readFileSync(contextFiles(root).json, 'utf8')) as { top: unknown[] };
    expect(again.top).toHaveLength(2);
    expect(tree(root)).toEqual(['.churnmap/HOTSPOTS.md', '.churnmap/hotspots.json']);
  });
});

describe('updateAgentNote', () => {
  it('creates, then appends to an existing file idempotently, touching only that file', async () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Our agents\n');
    await updateAgentNote(root, 'AGENTS.md');
    await updateAgentNote(root, 'AGENTS.md');
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    expect(text.startsWith('# Our agents\n\n')).toBe(true);
    expect(text.split(BLOCK_START)).toHaveLength(2);

    await updateAgentNote(root, '.cursor/rules/churnmap.mdc');
    expect(tree(root)).toEqual(['.cursor/rules/churnmap.mdc', 'AGENTS.md']);
    expect(readFileSync(join(root, '.cursor/rules/churnmap.mdc'), 'utf8')).toContain(
      'alwaysApply: true',
    );
  });

  it('refuses any other path', async () => {
    await expect(updateAgentNote(root, '../evil.md' as AgentNote)).rejects.toThrow(
      /not an agent notes file/,
    );
  });

  it('lists which notes exist', async () => {
    writeFileSync(join(root, 'CLAUDE.md'), 'x');
    expect([...(await existingAgentNotes(root, ['AGENTS.md', 'CLAUDE.md']))]).toEqual([
      'CLAUDE.md',
    ]);
  });
});

describe('ignoreContextDir and writeText', () => {
  it('creates or appends .gitignore once', async () => {
    await ignoreContextDir(root);
    await ignoreContextDir(root);
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('.churnmap/\n');
  });

  it('skips identical content and leaves no temp files', async () => {
    const file = join(root, 'a', 'b.txt');
    expect(await writeText(file, 'hi')).toBe(true);
    expect(await writeText(file, 'hi')).toBe(false);
    expect(tree(root)).toEqual(['a/b.txt']);
  });
});

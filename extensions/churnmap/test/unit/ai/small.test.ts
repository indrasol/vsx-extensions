import { describe, expect, it } from 'vitest';
import { chatTarget, VSCODE_CHAT_OPEN } from '../../../src/ai/chat.js';
import { NUDGE_INTERVAL_MS, NudgeClock } from '../../../src/ai/nudgeClock.js';
import type { CommitRecord } from '../../../src/analysis/model.js';
import { AnalysisStore } from '../../../src/analysis/store.js';
import {
  cleanSubject,
  recentSubjects,
  SUBJECT_FILES,
  subjectPaths,
} from '../../../src/analysis/subjects.js';
import { isWebviewToHost } from '../../../src/city/protocol.js';
import { analysis, fileScore } from './helpers.js';

describe('chatTarget', () => {
  it('uses VS Code’s chat.open with the brief as the query', () => {
    const target = chatTarget('Visual Studio Code', ['x', VSCODE_CHAT_OPEN]);
    expect(target?.command).toBe(VSCODE_CHAT_OPEN);
    expect(target?.argument('brief')).toEqual({ query: 'brief' });
  });

  it('is hidden in Cursor and wherever the command is missing', () => {
    expect(chatTarget('Cursor', [VSCODE_CHAT_OPEN])).toBeUndefined();
    expect(chatTarget('VSCodium', ['workbench.action.files.save'])).toBeUndefined();
  });
});

describe('NudgeClock', () => {
  it('nudges once per file per interval', () => {
    const clock = new NudgeClock();
    expect(clock.take('a.ts', 0)).toBe(true);
    expect(clock.take('a.ts', NUDGE_INTERVAL_MS - 1)).toBe(false);
    expect(clock.take('b.ts', 1)).toBe(true);
    expect(clock.take('a.ts', NUDGE_INTERVAL_MS)).toBe(true);
  });
});

const commit = (
  sha: string,
  timestamp: number,
  subject: string,
  paths: string[],
): CommitRecord => ({
  sha,
  authorName: 'A',
  authorEmail: 'a@example.com',
  timestamp,
  subject,
  files: paths.map((path) => ({ path, added: 1, deleted: 0, binary: false })),
});

describe('recentSubjects', () => {
  it('keeps the newest n subjects per wanted path, one line each', () => {
    const commits = [
      commit('1', 100, 'old', ['a.ts']),
      commit('3', 300, 'newest\nwith body line', ['a.ts', 'b.ts']),
      commit('2', 200, 'middle', ['a.ts', 'c.ts']),
      commit('4', 400, 'merge', []),
    ];
    expect(recentSubjects(commits, ['a.ts', 'b.ts'], 2)).toEqual({
      'a.ts': ['newest with body line', 'middle'],
      'b.ts': ['newest with body line'],
    });
  });

  it('cuts long subjects to 100 characters', () => {
    expect(cleanSubject('y'.repeat(150))).toHaveLength(100);
  });

  it('keeps subjects for the highest-scoring eligible files only', () => {
    const files = [
      fileScore('docs/a.md', 99, { eligible: false }),
      ...Array.from({ length: SUBJECT_FILES + 5 }, (_, i) => fileScore(`f${String(i)}.ts`, i)),
    ];
    const paths = subjectPaths(files);
    expect(paths).toHaveLength(SUBJECT_FILES);
    expect(paths[0]).toBe(`f${String(SUBJECT_FILES + 4)}.ts`);
    expect(paths).not.toContain('docs/a.md');
  });
});

describe('AnalysisStore.recentCommits', () => {
  it('returns the cached subjects for a path, newest first, or none', () => {
    const store = new AnalysisStore();
    expect(store.recentCommits('a.ts')).toEqual([]);
    store.set(analysis([fileScore('a.ts', 90)], { subjects: { 'a.ts': ['s1', 's2', 's3'] } }));
    expect(store.recentCommits('a.ts', 2)).toEqual(['s1', 's2']);
    expect(store.recentCommits('b.ts')).toEqual([]);
  });
});

describe('protocol: AI prompt and Export for agents', () => {
  it('accepts createAIPrompt with a repository-relative path only', () => {
    expect(isWebviewToHost({ type: 'createPrompt', path: 'src/a.ts' })).toBe(true);
    for (const bad of [
      { type: 'createPrompt', path: '../etc/passwd' },
      { type: 'createPrompt', path: '/etc/passwd' },
      { type: 'createPrompt' },
      { type: 'createPrompt', path: 'a.ts', template: 'x' },
    ]) {
      expect(isWebviewToHost(bad)).toBe(false);
    }
  });

  it('accepts exportForAgents with no payload only', () => {
    expect(isWebviewToHost({ type: 'exportForAgents' })).toBe(true);
    expect(isWebviewToHost({ type: 'exportForAgents', path: 'x' })).toBe(false);
  });
});

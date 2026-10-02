import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileNotFoundMessage, resolveRepoPath } from '../../src/openFile.js';

const ROOT = join('/work', 'repo');

describe('resolveRepoPath', () => {
  it('joins repository-relative paths under the root', () => {
    expect(resolveRepoPath(ROOT, 'src/a.ts')).toBe(join(ROOT, 'src', 'a.ts'));
    expect(resolveRepoPath(ROOT, 'README.md')).toBe(join(ROOT, 'README.md'));
  });

  it('refuses traversal, absolute, folded and malformed paths', () => {
    for (const p of [
      '../outside.ts',
      'src/../../outside.ts',
      '/etc/passwd',
      'C:/Windows/win.ini',
      'src\\..\\x',
      '',
      'src/big/…',
      42,
      null,
      undefined,
    ]) {
      expect(resolveRepoPath(ROOT, p), String(p)).toBeUndefined();
    }
  });
});

describe('fileNotFoundMessage', () => {
  it('names the path, shortened', () => {
    expect(fileNotFoundMessage('src/a.ts')).toBe('File not found: src/a.ts');
    expect(fileNotFoundMessage('x'.repeat(300))).toHaveLength('File not found: '.length + 120);
    expect(fileNotFoundMessage(7)).toBe('File not found: (not a path)');
  });
});

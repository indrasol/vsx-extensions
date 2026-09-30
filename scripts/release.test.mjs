import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { changelogSection } from './release-notes.mjs';
import { parseTag, resolveRelease } from './release-parse.mjs';

describe('parseTag', () => {
  it('splits <ext>@vX.Y.Z', () => {
    expect(parseTag('labs-pipeline-smoke@v0.0.1')).toEqual({
      ext: 'labs-pipeline-smoke',
      version: '0.0.1',
    });
  });

  it('accepts a pre-release version', () => {
    expect(parseTag('my-ext@v1.2.3-rc.1').version).toBe('1.2.3-rc.1');
  });

  it.each(['v1.0.0', 'my-ext@1.0.0', 'my-ext@v1.0', '@v1.0.0', 'My_Ext@v1.0.0', '../x@v1.0.0'])(
    'rejects %s',
    (tag) => {
      expect(() => parseTag(tag)).toThrow(/not <kebab-name>@vX\.Y\.Z/);
    },
  );
});

describe('resolveRelease', () => {
  let root;

  function workspace(parent, name, manifest) {
    const dir = join(root, parent, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'release-parse-'));
    workspace('extensions', 'my-ext', { name: 'my-ext', publisher: 'Indrasol', version: '1.2.3' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves a matching tag', () => {
    expect(resolveRelease(root, 'my-ext', '1.2.3')).toEqual({
      ext: 'my-ext',
      version: '1.2.3',
      tag: 'my-ext@v1.2.3',
      vsix: 'my-ext-1.2.3.vsix',
    });
  });

  it('takes the version from package.json when none is given (dispatch)', () => {
    expect(resolveRelease(root, 'my-ext').version).toBe('1.2.3');
  });

  it('rejects templates', () => {
    workspace('templates', 'extension-starter', {
      name: 'extension-starter',
      publisher: 'Indrasol',
      version: '0.0.0',
    });
    expect(() => resolveRelease(root, 'extension-starter', '0.0.0')).toThrow(/never released/);
  });

  it('rejects a missing workspace', () => {
    expect(() => resolveRelease(root, 'nope', '1.0.0')).toThrow(/No extension workspace/);
  });

  it('rejects a version mismatch', () => {
    expect(() => resolveRelease(root, 'my-ext', '1.2.4')).toThrow(/does not match/);
  });

  it('rejects the wrong publisher', () => {
    workspace('extensions', 'other', { name: 'other', publisher: 'indrasol', version: '1.0.0' });
    expect(() => resolveRelease(root, 'other', '1.0.0')).toThrow(/expected "Indrasol"/);
  });

  it('rejects a folder whose package name differs', () => {
    workspace('extensions', 'renamed', { name: 'other', publisher: 'Indrasol', version: '1.0.0' });
    expect(() => resolveRelease(root, 'renamed', '1.0.0')).toThrow(/name is "other"/);
  });

  it('rejects a path-like name', () => {
    expect(() => resolveRelease(root, '../templates/x')).toThrow(/kebab-case/);
  });
});

describe('changelogSection', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [1.1.0] - 2026-10-01',
    '',
    '### Added',
    '',
    '- A thing.',
    '',
    '## [1.0.0]',
    '',
    '- First.',
    '',
  ].join('\n');

  it('returns the section body', () => {
    expect(changelogSection(changelog, '1.1.0')).toBe('### Added\n\n- A thing.');
  });

  it('returns the last section up to the end', () => {
    expect(changelogSection(changelog, '1.0.0')).toBe('- First.');
  });

  it('returns undefined for a missing or empty section', () => {
    expect(changelogSection(changelog, '2.0.0')).toBeUndefined();
    expect(changelogSection('## [1.0.0]\n\n## [0.9.0]\n', '1.0.0')).toBeUndefined();
  });

  it('does not match a longer version with the same prefix', () => {
    expect(changelogSection('## [1.0.10]\n\n- x\n', '1.0.1')).toBeUndefined();
  });
});

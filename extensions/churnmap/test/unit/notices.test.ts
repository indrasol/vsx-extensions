import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED, OUTPUT, packageDirOf, render } from '../../scripts/third-party-notices.mjs';

function fakePackage(name: string, license: string, withText = true) {
  const dir = mkdtempSync(join(tmpdir(), 'cm-notice-'));
  if (withText) writeFileSync(join(dir, 'LICENSE'), `${license} licence text of ${name}`);
  return { name, version: '1.0.0', license, dir };
}

describe('third-party notices', () => {
  it('maps a bundled file to its package folder (pnpm layout, scopes) and skips our own code', () => {
    expect(packageDirOf('node_modules/.pnpm/ajv@8.20.0/node_modules/ajv/dist/core.js')).toBe(
      'node_modules/.pnpm/ajv@8.20.0/node_modules/ajv',
    );
    expect(
      packageDirOf(
        'node_modules/.pnpm/@modelcontextprotocol+sdk@1.31.0/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.js',
      ),
    ).toBe(
      'node_modules/.pnpm/@modelcontextprotocol+sdk@1.31.0/node_modules/@modelcontextprotocol/sdk',
    );
    expect(packageDirOf('node_modules\\three\\build\\three.module.js')).toBe('node_modules/three');
    expect(packageDirOf('src/extension.ts')).toBeUndefined();
    expect(packageDirOf('../../../vsx-extensions/packages/labs-core/src/index.ts')).toBeUndefined();
  });

  it('allows only MIT, ISC, BSD-2/3 and Apache-2.0', () => {
    expect([...ALLOWED].sort()).toEqual([
      'Apache-2.0',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'ISC',
      'MIT',
    ]);
  });

  it('lists each package with its licence text, and fails on another licence or no text', () => {
    const ok = render([fakePackage('alpha', 'MIT'), fakePackage('beta', 'BSD-3-Clause')]);
    expect(ok.problems).toEqual([]);
    expect(ok.text).toContain('- alpha 1.0.0 (MIT)');
    expect(ok.text).toContain('BSD-3-Clause licence text of beta');

    const bad = render([fakePackage('gamma', 'GPL-3.0'), fakePackage('delta', 'MIT', false)]);
    expect(bad.problems).toEqual([
      'gamma@1.0.0: licence GPL-3.0 is not allowed',
      'delta@1.0.0: no licence file',
    ]);
  });

  it('the shipped file lists three and the MCP SDK (run `pnpm build` to refresh it)', () => {
    expect(existsSync(OUTPUT)).toBe(true);
    const text = readFileSync(OUTPUT, 'utf8');
    expect(text).toMatch(/^- three \d/m);
    expect(text).toMatch(/^- @modelcontextprotocol\/sdk \d/m);
    expect(text).toMatch(/^- zod \d/m);
  });
});

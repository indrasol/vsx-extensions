import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_SUMMARIES,
  commandsTable,
  MARKERS,
  paletteCommands,
  settingsTable,
  tableCells,
} from '../../scripts/readme-tables.mjs';
import { links } from '../../src/links.js';

interface Manifest {
  displayName: string;
  description: string;
  keywords: string[];
  qna: unknown;
  contributes: {
    walkthroughs: { steps: { description: string }[] }[];
  };
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
const readme = readFileSync('README.md', 'utf8');

/** Every file under `dir`, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('store listing (package.json)', () => {
  it('has a display name people search for', () => {
    expect(manifest.displayName).toBe('Churnmap: Code Hotspots City');
  });

  it('has a description of at most 150 characters ending "by Indrasol Labs" (ADR-0008)', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(150);
    expect(manifest.description.endsWith('by Indrasol Labs')).toBe(true);
    expect(manifest.description).toMatch(/code hotspots/);
    expect(manifest.description).toMatch(/technical debt/);
  });

  it('has exactly 30 lowercase keywords and no duplicates', () => {
    expect(manifest.keywords).toHaveLength(30);
    expect(new Set(manifest.keywords).size).toBe(30);
    for (const k of manifest.keywords) expect(k).toBe(k.toLowerCase());
  });

  it('sends questions to GitHub issues', () => {
    expect(manifest.qna).toBe(false);
  });

  it('ends the walkthrough with the Talk to Indrasol link', () => {
    const steps = manifest.contributes.walkthroughs[0]?.steps ?? [];
    expect(steps.at(-1)?.description).toMatch(
      /Questions, a demo or a team rollout\? \[Talk to Indrasol\]\(command:churnmap\.openTalkLink\)$/,
    );
  });

  it('has no early-access or teams link anywhere', () => {
    expect(JSON.stringify(manifest)).not.toMatch(/to=teams|early access|openTeamsLink/i);
    expect(readme).not.toMatch(/to=teams|early access/i);
  });
});

describe('README', () => {
  it('starts with the demo GIF', () => {
    expect(readme.split('\n')[0]).toBe(
      '![Churnmap: your repository as a 3D city, hotspots glowing](media/readme/demo.gif)',
    );
  });

  it('has every Definition-of-done section', () => {
    for (const heading of [
      '## Quick start',
      '## Features',
      '## How to read it',
      '## How scoring works',
      '### What Churnmap is not',
      '## Settings',
      '## Commands',
      '## Works with',
      '## Privacy and telemetry',
      '## Security',
      '## FAQ',
      '## Talk to Indrasol',
      '## More from Indrasol Labs',
    ]) {
      expect(readme).toContain(`\n${heading}\n`);
    }
  });

  it('has a settings table that matches package.json', () => {
    expect(tableCells(readme, MARKERS.settings)).toEqual(
      tableCells(MARKERS.settings.join(`\n${settingsTable(manifest)}\n`), MARKERS.settings),
    );
    expect(tableCells(readme, MARKERS.settings).length).toBeGreaterThan(1);
  });

  it('has a commands table that matches package.json', () => {
    expect(tableCells(readme, MARKERS.commands)).toEqual(
      tableCells(MARKERS.commands.join(`\n${commandsTable(manifest)}\n`), MARKERS.commands),
    );
    for (const c of paletteCommands(manifest)) expect(COMMAND_SUMMARIES[c.command]).toBeTruthy();
  });

  it('uses the first-party links for Talk to Indrasol and the footer', () => {
    expect(readme).toContain(`[Talk to Indrasol](${links.talk('readme')})`);
    expect(readme).toContain(`Built by [Indrasol](${links.indrasol('readme')})`);
  });

  it('links only to Indrasol short links, GitHub and the two stores', () => {
    const urls = [...readme.matchAll(/https?:\/\/[^\s)]+/g)].map((m) => new URL(m[0]));
    for (const url of urls) {
      expect([
        'labs.indrasol.com',
        'github.com',
        'marketplace.visualstudio.com',
        'open-vsx.org',
      ]).toContain(url.host);
    }
  });

  it('has no private references', () => {
    // "AI prompt" is a product term; the planning repo's prompt files are not.
    for (const text of [readme, readFileSync('CHANGELOG.md', 'utf8')]) {
      expect(text).not.toMatch(
        /labs-internal|CLAUDE_CODE|prompts\/|_PROMPT_|PROMPT_\d|\bP0\b|task 0|spec §/i,
      );
    }
  });
});

describe('outbound links', () => {
  it('are built only in src/links.ts (no other https:// in src or webview)', () => {
    const offenders = [...files('src'), ...files('webview')]
      .filter((f) => f !== join('src', 'links.ts'))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ f, i, line }))
          .filter(({ line }) => line.includes('https://') && !line.includes('www.w3.org/2000/svg')),
      )
      .map(({ f, i }) => `${f}:${String(i + 1)}`);
    expect(offenders).toEqual([]);
  });
});

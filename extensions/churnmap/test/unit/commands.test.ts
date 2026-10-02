import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/commands.js';

interface Manifest {
  contributes: {
    commands: { command: string }[];
    menus: { commandPalette: { command: string; when: string }[] };
  };
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;

describe('COMMANDS', () => {
  it('matches the commands contributed in package.json', () => {
    const contributed = manifest.contributes.commands.map((c) => c.command).sort();
    expect(Object.values(COMMANDS).sort()).toEqual(contributed);
  });

  it('hides the commands that need an argument, and the walkthrough link, from the palette', () => {
    const hidden = manifest.contributes.menus.commandPalette
      .filter((m) => m.when === 'false')
      .map((m) => m.command)
      .sort();
    expect(hidden).toEqual(
      [
        COMMANDS.openFile,
        COMMANDS.showInCity,
        COMMANDS.showChangedHotspots,
        COMMANDS.openTalkLink,
      ].sort(),
    );
  });
});

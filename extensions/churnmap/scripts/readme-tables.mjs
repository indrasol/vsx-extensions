// Writes the README's Settings and Commands tables from package.json, so they never drift.
//
//   node scripts/readme-tables.mjs          rewrite README.md between the table markers
//   node scripts/readme-tables.mjs --check  exit 1 if README.md is out of date
//
// test/unit/readme.test.ts runs the same comparison on every `pnpm test`.
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * What each palette command does, in one line. Commands hidden from the palette are left out;
 * the unit test fails when a visible command has no line here.
 * @type {Record<string, string>}
 */
export const COMMAND_SUMMARIES = {
  'churnmap.build': 'Analyse the repository and open the city.',
  'churnmap.open': 'Open the city (builds first if nothing is cached).',
  'churnmap.showHotspots': 'Focus the Hotspots view on rank 1.',
  'churnmap.setWindow': 'Switch the history window: 30, 90 or 365 days.',
  'churnmap.toggleTreemap': 'Switch the city between 3D and the 2D treemap.',
  'churnmap.exportPostcard': 'Save a 1600×900 PNG of the city and the top three.',
  'churnmap.ignoreHotspot': 'Silence a hotspot for 90 days, with a reason.',
  'churnmap.unignore': 'Bring an ignored hotspot back.',
  'churnmap.clearCache': 'Delete the cached analyses.',
  'churnmap.copyHotspotsMarkdown': 'Copy the ranked list as a Markdown table.',
  'churnmap.selectRepository': 'Choose which repository in the workspace to analyse.',
  'churnmap.createAIPrompt':
    'Create a ready-to-paste prompt about a hotspot for your own AI agent; you review it, then copy it.',
  'churnmap.createAIPromptTop': 'The same prompt for the #1 hotspot, without choosing.',
  'churnmap.exportForAgents': 'Write .churnmap/HOTSPOTS.md and hotspots.json for AI agents.',
  'churnmap.addToAgent': 'Give Cursor, Claude Code or VS Code the local MCP server.',
  'churnmap.rankCodeOnly':
    'Rank source code only again after “Rank all files” (shown only while every file ranks).',
};

export const MARKERS = {
  settings: ['<!-- settings-table:start -->', '<!-- settings-table:end -->'],
  commands: ['<!-- commands-table:start -->', '<!-- commands-table:end -->'],
};

/**
 * A table cell: one line, pipes escaped. Only pipes: in a GFM table `\|` is the cell-pipe escape
 * even inside a code span, while other backslashes there render literally (`\b` stays `\b`), so
 * escaping them would show doubled backslashes in the listing. @param {string} text
 */
function cell(text) {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .split('|')
    .join('\\|');
}

/** @param {unknown} value */
function formatDefault(value) {
  if (Array.isArray(value)) return value.map((v) => `\`${String(v)}\``).join(', ');
  return `\`${typeof value === 'string' ? value : JSON.stringify(value)}\``;
}

/** The first paragraph of a setting's description. @param {Record<string, unknown>} schema */
function summary(schema) {
  const text = String(schema.markdownDescription ?? schema.description ?? '');
  return text.split(/\n\s*\n/)[0] ?? '';
}

/** @param {string[]} header @param {string[][]} rows */
function table(header, rows) {
  const line = (/** @type {string[]} */ cells) => `| ${cells.map(cell).join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}

/** @param {any} manifest */
export function settingsTable(manifest) {
  const properties = manifest.contributes.configuration.properties;
  return table(
    ['Setting', 'Default', 'What it does'],
    Object.entries(properties).map(([key, schema]) => {
      const values = Array.isArray(schema.enum)
        ? ` One of ${schema.enum.map((v) => `\`${String(v)}\``).join(', ')}.`
        : '';
      return [`\`${key}\``, formatDefault(schema.default), `${summary(schema)}${values}`];
    }),
  );
}

/** Commands shown in the Command Palette (the hidden ones need an argument or a click). @param {any} manifest */
export function paletteCommands(manifest) {
  const hidden = new Set(
    manifest.contributes.menus.commandPalette
      .filter((/** @type {{ when: string }} */ m) => m.when === 'false')
      .map((/** @type {{ command: string }} */ m) => m.command),
  );
  return manifest.contributes.commands.filter(
    (/** @type {{ command: string }} */ c) => !hidden.has(c.command),
  );
}

/** @param {any} manifest */
export function commandsTable(manifest) {
  return table(
    ['Command', 'What it does'],
    paletteCommands(manifest).map(
      (/** @type {{ command: string, title: string, category: string }} */ c) => [
        `**${c.category}: ${c.title}**`,
        COMMAND_SUMMARIES[c.command] ?? '',
      ],
    ),
  );
}

/** Replaces the text between `markers` with `body`. @param {string} text @param {string[]} markers @param {string} body */
function replaceBetween(text, [start, end], body) {
  const from = text.indexOf(start ?? '');
  const to = text.indexOf(end ?? '');
  if (from < 0 || to < from) throw new Error(`README.md has no ${String(start)} … ${String(end)}`);
  return `${text.slice(0, from + (start ?? '').length)}\n\n${body}\n\n${text.slice(to)}`;
}

/** The README with both tables regenerated. @param {string} readme @param {any} manifest */
export function withTables(readme, manifest) {
  const settings = replaceBetween(readme, MARKERS.settings, settingsTable(manifest));
  return replaceBetween(settings, MARKERS.commands, commandsTable(manifest));
}

/**
 * The rows of the Markdown table between `markers`, as trimmed cells (padding and the separator
 * row ignored), so a Prettier-aligned table compares equal to a generated one.
 * @param {string} text @param {string[]} markers
 */
export function tableCells(text, [start, end]) {
  const from = text.indexOf(start ?? '');
  const to = text.indexOf(end ?? '');
  if (from < 0 || to < from) return [];
  return text
    .slice(from, to)
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[\s:|-]+\|$/.test(l))
    .map((l) =>
      l
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim()),
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  const readme = readFileSync('README.md', 'utf8');
  const next = withTables(readme, manifest);
  const same = Object.values(MARKERS).every(
    (m) => JSON.stringify(tableCells(readme, m)) === JSON.stringify(tableCells(next, m)),
  );
  if (process.argv.includes('--check')) {
    console.log(same ? 'README tables are up to date.' : 'README tables are out of date.');
    process.exit(same ? 0 : 1);
  }
  if (!same) {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig('README.md')) ?? {};
    writeFileSync('README.md', await prettier.format(next, { ...options, parser: 'markdown' }));
  }
  console.log(same ? 'README tables are up to date.' : 'README tables rewritten.');
}

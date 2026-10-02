/**
 * The daily surfaces' pure parts: status-bar text, and mapping editor and SCM paths onto
 * repository-relative hotspot paths. No `vscode` import, so all of it is unit-tested.
 */
import * as nodePath from 'node:path';
import { normalizeRoot } from '../analysis/cache.js';
import { bandOfFile } from '../analysis/bands.js';
import type { Band, Hotspot } from '../analysis/model.js';
import { bandLabel } from '../city/palette.js';
import { trendText, wholeScore } from '../panel/hotspotTree.js';

/** `$(flame) Hotspot #3`, or `$(flame) Watch #7` for a ranked file in the Watch band. */
export function rankText(rank: number, band: Band = 'hotspot'): string {
  return `$(flame) ${bandLabel(band)} #${String(rank)}`;
}

/** The top three ranks get the warning background. */
export function isWarningRank(rank: number): boolean {
  return rank <= 3;
}

/** `$(warning) 2 hotspots in your changes` (singular for one). */
export function scmText(count: number): string {
  return `$(warning) ${String(count)} ${count === 1 ? 'hotspot' : 'hotspots'} in your changes`;
}

/** Screen readers: the same without the icon. */
export function scmAccessibilityLabel(count: number): string {
  return `${String(count)} ${count === 1 ? 'hotspot is' : 'hotspots are'} in your staged or working-tree changes`;
}

/** The status-bar item's hover: rank, path, band, score, trend and reasons (Markdown, no HTML). */
export function rankTooltip(hotspot: Hotspot): string {
  return [
    `**#${String(hotspot.rank)}**: ${hotspot.file.path.replace(/[\\`*_[\]<>|]/g, '\\$&')}`,
    '',
    `${bandLabel(bandOfFile(hotspot.file))} · score ${wholeScore(hotspot.file.score)} · ${trendText(hotspot.trend)}`,
    '',
    ...hotspot.reasons.map((r) => `- ${r.text} (${r.detail})`),
    '',
    'Click to show it in the Hotspots view.',
  ].join('\n');
}

type PathApi = Pick<typeof nodePath.posix, 'relative' | 'isAbsolute' | 'sep'>;

function pathApi(platform: NodeJS.Platform): PathApi {
  return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

/**
 * `file` relative to the first root that contains it, with forward slashes; undefined when it is
 * outside every root. On Windows the comparison ignores case and slash direction.
 */
export function repoRelative(
  roots: readonly string[],
  file: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const api = pathApi(platform);
  const fold = (p: string): string => (platform === 'win32' ? p.toLowerCase() : p);
  for (const root of roots) {
    const rel = api.relative(fold(root), fold(file));
    if (rel === '' || rel === '..' || rel.startsWith(`..${api.sep}`) || api.isAbsolute(rel)) {
      continue;
    }
    // Keep the file's own spelling (relative() above ran on case-folded input).
    const original = file.slice(file.length - rel.length);
    return original.split(api.sep).join('/');
  }
  return undefined;
}

/**
 * The paths a symlinked workspace is seen under: the repository root as git reports it (a real
 * path) plus, for each workspace folder whose real path is inside the repository, the same root
 * spelled the way the folder is (for example `/var/…` for git's `/private/var/…` on macOS).
 */
export async function repoRoots(
  repoRoot: string,
  folders: readonly string[],
  realpath: (p: string) => Promise<string>,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  const roots = [repoRoot];
  const root = normalizeRoot(repoRoot, platform);
  for (const folder of folders) {
    let real: string;
    try {
      real = normalizeRoot(await realpath(folder), platform);
    } catch {
      continue;
    }
    if (real !== root && !real.startsWith(`${root}/`)) continue;
    const suffix = real.slice(root.length); // '' or '/sub/dir'
    const spelled = normalizeRoot(folder, platform);
    if (!spelled.endsWith(suffix)) continue;
    const alias = folder.slice(0, folder.replace(/[\\/]+$/, '').length - suffix.length);
    if (alias && !roots.includes(alias)) roots.push(alias);
  }
  return roots;
}

/**
 * The hotspots among `changed` (absolute paths under `root`, the Git repository's root), in rank
 * order. Files outside the root and duplicates are ignored.
 */
export function changedHotspots(
  root: string,
  changed: readonly string[],
  top: readonly Hotspot[],
  platform: NodeJS.Platform = process.platform,
): Hotspot[] {
  const fold = (p: string): string => (platform === 'win32' ? p.toLowerCase() : p);
  const paths = new Set<string>();
  for (const file of changed) {
    const rel = repoRelative([root], file, platform);
    if (rel !== undefined) paths.add(fold(rel));
  }
  return top.filter((h) => paths.has(fold(h.file.path)));
}

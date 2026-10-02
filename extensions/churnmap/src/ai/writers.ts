/**
 * Every file Churnmap writes into a repository, in one place: the two context files under
 * `.churnmap/`, the agent-notes block, and `.gitignore` (only when the user says yes). Each writer
 * is idempotent and writes only its documented path. Node only (no `vscode`), so the MCP server
 * shares it.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { AnalysisResult, IgnoredFile } from '../analysis/model.js';
import {
  CONTEXT_DIR,
  HOTSPOTS_JSON,
  HOTSPOTS_MD,
  renderHotspotsJson,
  renderHotspotsMd,
} from './agentContext.js';
import {
  type AgentNote,
  isAgentNote,
  upsertNotesBlock,
  withContextDirIgnored,
} from './agentNotes.js';

/** Reads a text file; undefined when it does not exist. */
export async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** Writes through a temp file and a rename, creating the folder; skips identical content. */
export async function writeText(file: string, text: string): Promise<boolean> {
  if ((await readText(file)) === text) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, text, 'utf8');
    await fs.rename(temp, file);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
  return true;
}

export function contextFiles(repoRoot: string): { md: string; json: string } {
  const dir = path.join(repoRoot, CONTEXT_DIR);
  return { md: path.join(dir, HOTSPOTS_MD), json: path.join(dir, HOTSPOTS_JSON) };
}

/** True when `.churnmap/hotspots.json` exists (the user exported once, so builds refresh it). */
export async function hasContextFiles(repoRoot: string): Promise<boolean> {
  try {
    return (await fs.stat(contextFiles(repoRoot).json)).isFile();
  } catch {
    return false;
  }
}

/** Writes (or overwrites) `.churnmap/HOTSPOTS.md` and `.churnmap/hotspots.json`. */
export async function writeContextFiles(
  result: AnalysisResult,
  ignored: readonly IgnoredFile[] = [],
): Promise<{ md: string; json: string }> {
  const files = contextFiles(result.repoRoot);
  await writeText(files.md, renderHotspotsMd(result, ignored));
  await writeText(files.json, `${JSON.stringify(renderHotspotsJson(result), null, 2)}\n`);
  return files;
}

/**
 * Adds or replaces Churnmap's block in one of the known agent-notes files; `mcp` adds the line
 * that sends the agent to the MCP tools.
 */
export async function updateAgentNote(
  repoRoot: string,
  note: AgentNote,
  opts: { mcp?: boolean } = {},
): Promise<string> {
  if (!isAgentNote(note)) throw new Error(`not an agent notes file: ${String(note)}`);
  const file = path.join(repoRoot, ...note.split('/'));
  await writeText(file, upsertNotesBlock(await readText(file), note, opts));
  return file;
}

/** Which agent-notes files exist in the repository. */
export async function existingAgentNotes(
  repoRoot: string,
  notes: readonly AgentNote[],
): Promise<Set<AgentNote>> {
  const found = new Set<AgentNote>();
  for (const note of notes) {
    if ((await readText(path.join(repoRoot, ...note.split('/')))) !== undefined) found.add(note);
  }
  return found;
}

/** Appends `.churnmap/` to the repository's `.gitignore` (created when missing). */
export async function ignoreContextDir(repoRoot: string): Promise<void> {
  const file = path.join(repoRoot, '.gitignore');
  await writeText(file, withContextDirIgnored(await readText(file)));
}

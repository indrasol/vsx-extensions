import { isAbsolute, join, relative, sep } from 'node:path';
import { isRepoRelativePath } from './city/protocol.js';

/**
 * The absolute path for a repository-relative `path` under `root`, or undefined when `path` is
 * not a plain repository-relative path (absolute, `..`, backslashes, empty, not a string) or would
 * resolve outside `root`. Existence is checked by the caller.
 */
export function resolveRepoPath(root: string, path: unknown): string | undefined {
  if (!isRepoRelativePath(path) || path.endsWith('/…')) return undefined;
  const full = join(root, ...path.split('/'));
  const rel = relative(root, full);
  if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) return undefined;
  return full;
}

/** The warning shown when a path cannot be opened; the path is cut so the toast stays short. */
export function fileNotFoundMessage(path: unknown): string {
  const text = typeof path === 'string' ? path : '(not a path)';
  return `File not found: ${text.length > 120 ? `${text.slice(0, 119)}…` : text}`;
}

/**
 * What a postcard may say about the repository, decided on the host before anything is sent to
 * the webview. Pure, so every rule is unit-tested.
 */
import type { Hotspot } from '../analysis/model.js';
import type { PostcardDetail, PostcardMessage } from '../city/protocol.js';

/** How many hotspots the postcard lists. */
export const POSTCARD_TOP = 3;

/**
 * A hotspot's label at a detail level: the path; only its top-level folder (`(root)` for a file
 * at the root); or just `#rank`.
 */
export function postcardLabel(path: string, rank: number, detail: PostcardDetail): string {
  switch (detail) {
    case 'paths':
      return path;
    case 'districts': {
      const slash = path.indexOf('/');
      return slash > 0 ? path.slice(0, slash) : '(root)';
    }
    case 'none':
      return `#${String(rank)}`;
  }
}

/** The top three as the webview gets them: rank, reduced label, whole score and colour heat. */
export function postcardTop(
  top: readonly Hotspot[],
  detail: PostcardDetail,
): PostcardMessage['top'] {
  return top.slice(0, POSTCARD_TOP).map((h) => ({
    rank: h.rank,
    label: postcardLabel(h.file.path, h.rank, detail),
    score: Math.round(h.file.score),
    heat: h.file.heat ?? h.file.score,
  }));
}

/**
 * `churnmap-<repo>-<yyyy-mm-dd>.png`, with the repository name reduced to lower-case ASCII
 * letters, digits, dots and dashes (accents dropped, anything else a dash).
 */
export function postcardFileName(repoName: string, date: string): string {
  const safe = repoName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
  return `churnmap-${safe || 'repo'}-${date}.png`;
}

/** `1.1 MB`, `412 KB`: for the "Postcard saved" message. */
export function formatSize(bytes: number): string {
  if (bytes >= 100 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

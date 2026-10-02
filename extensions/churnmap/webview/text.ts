/**
 * Path text for labels, cards and the postcard. Paths are shortened in the middle
 * (`src/…/invoice.ts`), never at the end, because the file name is what people look for.
 */

/** The last segment of a path (a folded leaf's `folder/…` keeps its folder). */
export function fileName(path: string): string {
  const parts = path.split('/');
  const last = parts.at(-1) ?? path;
  return last === '…' && parts.length >= 2 ? `${parts.at(-2) ?? ''}/…` : last;
}

/** Everything before the last segment, with a trailing slash; `''` at the root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash + 1);
}

/** Cuts a single name in the middle, keeping its extension: `very_lo…_name.ts`. */
function cutName(name: string, max: number): string {
  if (name.length <= max) return name;
  if (max <= 1) return '…';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const room = max - 1;
  const tail = Math.min(ext.length + Math.max(0, Math.floor((room - ext.length) / 3)), room);
  const head = room - tail;
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
}

/**
 * The path shortened to at most `max` characters, cut in the middle: it keeps the first folder and
 * as many trailing segments as fit (`src/…/billing/invoice.ts`), then just the file name
 * (`…/invoice.ts`), and only then cuts the name itself.
 */
export function middleTruncate(path: string, max: number): string {
  if (path.length <= max) return path;
  const parts = path.split('/');
  const name = parts.at(-1) ?? path;
  if (parts.length >= 2) {
    const head = parts[0] ?? '';
    // Keep as many trailing segments as fit after "head/…/".
    for (let keep = parts.length - 2; keep >= 1; keep--) {
      const candidate = `${head}/…/${parts.slice(parts.length - keep).join('/')}`;
      if (candidate.length <= max) return candidate;
    }
    const short = `…/${name}`;
    if (short.length <= max) return short;
  }
  return cutName(name, max);
}

/** The longest middle-truncation of `path` whose `measure` fits `maxWidth` ('' if none does). */
export function middleTruncateToWidth(
  path: string,
  maxWidth: number,
  measure: (text: string) => number,
): string {
  if (measure(path) <= maxWidth) return path;
  let lo = 1;
  let hi = path.length - 1;
  let best = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const text = middleTruncate(path, mid);
    if (measure(text) <= maxWidth) {
      best = text;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

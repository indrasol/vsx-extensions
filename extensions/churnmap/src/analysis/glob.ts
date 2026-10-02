/**
 * A small, dependency-free glob matcher for repository-relative, forward-slash paths.
 * Supports `**`, `*`, `?` and `{a,b}`; every other character matches itself. A pattern without a
 * `/` matches the file's basename at any depth, like `.gitignore`. Negation is not supported.
 */

/** Always excluded, before `churnmap.exclude` (generated, vendored and lock files). */
export const BUILTIN_EXCLUDES: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
  '**/*.min.*',
  '**/*.lock',
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/*.snap',
  '**/*.map',
  '**/vendor/**',
  '**/.git/**',
];

const REGEX_SPECIAL = /[.+^$()|[\]\\{}]/;

/** Translates one glob (without a leading `./` or `/`) to a regular-expression source. */
function translate(glob: string): string {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob.charAt(i);
    if (ch === '*') {
      if (glob.charAt(i + 1) === '*') {
        const atSegmentStart = i === 0 || glob.charAt(i - 1) === '/';
        const next = glob.charAt(i + 2);
        if (atSegmentStart && next === '/') {
          // `**/` — zero or more whole directories.
          out += '(?:[^/]*/)*';
          i += 3;
          continue;
        }
        if (atSegmentStart && next === '') {
          // Trailing `/**` — everything inside the directory (at least one character).
          out += '.+';
          i += 2;
          continue;
        }
        out += '.*';
        i += 2;
        continue;
      }
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '{') {
      const close = findClosingBrace(glob, i);
      if (close === -1) {
        out += '\\{';
      } else {
        const alternatives = splitTopLevel(glob.slice(i + 1, close));
        out += `(?:${alternatives.map(translate).join('|')})`;
        i = close + 1;
        continue;
      }
    } else if (REGEX_SPECIAL.test(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
}

function findClosingBrace(glob: string, open: number): number {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob.charAt(i) === '{') depth += 1;
    else if (glob.charAt(i) === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** Compiles one glob to an anchored regular expression. */
export function globToRegExp(pattern: string): RegExp {
  let glob = pattern.trim().replace(/\\/g, '/');
  if (glob.startsWith('./')) glob = glob.slice(2);
  else if (glob.startsWith('/')) glob = glob.slice(1);
  if (glob.endsWith('/')) glob += '**';
  const basenameOnly = !glob.includes('/');
  const body = translate(glob);
  return new RegExp(basenameOnly ? `^(?:[^/]*/)*${body}$` : `^${body}$`);
}

/** Returns a predicate that is true when a path matches any of the patterns. */
export function compileGlobs(patterns: readonly string[]): (path: string) => boolean {
  const regexes = patterns.filter((p) => p.trim().length > 0).map(globToRegExp);
  if (regexes.length === 0) return () => false;
  return (path) => regexes.some((re) => re.test(path));
}

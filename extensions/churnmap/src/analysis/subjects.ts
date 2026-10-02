import type { CommitRecord, FileScore } from './model.js';

/** Commit subjects kept per file, newest first. */
export const RECENT_SUBJECTS = 10;
/** Longest subject kept; longer ones are cut with an ellipsis. */
export const MAX_SUBJECT_LENGTH = 100;
/**
 * Files that keep their subjects: the highest-scoring eligible ones, so the top 20 still has
 * subjects after the user ignores a few and the next files move up.
 */
export const SUBJECT_FILES = 50;

/** One line, runs of whitespace collapsed, at most `MAX_SUBJECT_LENGTH` characters. */
export function cleanSubject(subject: string): string {
  const line = subject.replace(/\s+/g, ' ').trim();
  return line.length <= MAX_SUBJECT_LENGTH ? line : `${line.slice(0, MAX_SUBJECT_LENGTH - 1)}…`;
}

/**
 * The last `n` commit subjects (subjects only, never bodies) touching each of `paths`, newest
 * first. Merge commits carry no files, so they never appear.
 */
export function recentSubjects(
  commits: readonly CommitRecord[],
  paths: readonly string[],
  n: number = RECENT_SUBJECTS,
): Record<string, string[]> {
  const wanted = new Set(paths);
  const out: Record<string, string[]> = {};
  const newestFirst = [...commits].sort((a, b) => b.timestamp - a.timestamp);
  for (const commit of newestFirst) {
    for (const change of commit.files) {
      if (!wanted.has(change.path)) continue;
      const list = (out[change.path] ??= []);
      if (list.length < n) list.push(cleanSubject(commit.subject));
    }
  }
  return out;
}

/** The files whose subjects are kept: the `SUBJECT_FILES` highest-scoring eligible files. */
export function subjectPaths(files: readonly FileScore[]): string[] {
  return files
    .filter((f) => f.eligible)
    .sort((a, b) => b.score - a.score)
    .slice(0, SUBJECT_FILES)
    .map((f) => f.path);
}

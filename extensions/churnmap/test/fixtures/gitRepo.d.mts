// Types for gitRepo.mjs, so TypeScript tests can use it.
export function git(cwd: string, args: string[], env?: Record<string, string>): Buffer;
export function initRepo(dir: string): void;
export function writeFiles(dir: string, files: Record<string, string | Buffer>): void;
export function commitAll(
  dir: string,
  c: { message: string; date: string; name?: string; email?: string; extra?: string[] },
): void;
export function lines(n: number, indent?: string): string;

import { EventEmitter } from 'node:events';
import type { IgnoredFile } from '../analysis/model.js';
import { isRepoRelativePath } from '../city/protocol.js';

/** workspaceState key; bump the suffix if the stored shape changes. */
export const IGNORE_KEY = 'churnmap.ignored.v1';
export const IGNORE_DAYS = 90;
export const MAX_REASON_LENGTH = 200;
const DAY_MS = 86_400_000;

/** One ignored hotspot: a repository-relative path, why, and until when (ms since the epoch). */
export type IgnoreEntry = IgnoredFile;

/** The part of `vscode.Memento` the store needs, so it is unit-testable without VS Code. */
export interface MementoLike {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

/** Trimmed, line breaks flattened, cut to `MAX_REASON_LENGTH`. */
export function normalizeReason(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON_LENGTH);
}

/** The input box's check: undefined when fine, else the message shown under the box. */
export function validateReason(text: string): string | undefined {
  return text.trim().length > MAX_REASON_LENGTH
    ? `Keep it under ${String(MAX_REASON_LENGTH)} characters.`
    : undefined;
}

/** The reason as shown to the user. */
export function reasonText(entry: IgnoreEntry): string {
  return entry.reason || 'no reason given';
}

/** Whole days until the entry expires, rounded up (an entry is never "0 d left" while it lives). */
export function daysLeft(entry: IgnoreEntry, now: number): number {
  return Math.max(0, Math.ceil((entry.until - now) / DAY_MS));
}

/** `yyyy-mm-dd` (UTC) of the expiry. */
export function untilDate(entry: IgnoreEntry): string {
  return new Date(entry.until).toISOString().slice(0, 10);
}

function isEntry(x: unknown): x is IgnoreEntry {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Partial<Record<keyof IgnoreEntry, unknown>>;
  return (
    isRepoRelativePath(e.path) &&
    typeof e.reason === 'string' &&
    e.reason.length <= MAX_REASON_LENGTH &&
    typeof e.until === 'number' &&
    Number.isFinite(e.until)
  );
}

/**
 * Hotspots the user has consciously decided not to fix, kept in the workspace's state for 90
 * days (never in a file, never sent anywhere). Expired and malformed entries are dropped whenever
 * the list is read. Ignores are workspace state, not analysis: the cache is never changed.
 */
export class IgnoreStore {
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly memento: MementoLike,
    private readonly clock: () => number = Date.now,
  ) {}

  private read(): unknown[] {
    const raw = this.memento.get(IGNORE_KEY);
    return Array.isArray(raw) ? (raw as unknown[]) : [];
  }

  /** The live entries, sorted by path. Purges expired or malformed ones from storage. */
  list(): IgnoreEntry[] {
    const raw = this.read();
    const now = this.clock();
    const live = raw.filter((e): e is IgnoreEntry => isEntry(e) && e.until > now);
    if (live.length !== raw.length) void this.memento.update(IGNORE_KEY, live);
    return [...live].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  has(path: string): boolean {
    return this.list().some((e) => e.path === path);
  }

  /** Ignores `path` for `days` from now; ignoring it again replaces the reason and the expiry. */
  async add(path: string, reason: string, days = IGNORE_DAYS): Promise<IgnoreEntry> {
    if (!isRepoRelativePath(path)) throw new Error('not a repository-relative path');
    const entry: IgnoreEntry = {
      path,
      reason: normalizeReason(reason),
      until: this.clock() + days * DAY_MS,
    };
    await this.memento.update(IGNORE_KEY, [...this.list().filter((e) => e.path !== path), entry]);
    this.emitter.emit('change');
    return entry;
  }

  /** Un-ignores `path`; false when it was not ignored. */
  async remove(path: string): Promise<boolean> {
    const entries = this.list();
    const rest = entries.filter((e) => e.path !== path);
    if (rest.length === entries.length) return false;
    await this.memento.update(IGNORE_KEY, rest);
    this.emitter.emit('change');
    return true;
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.emitter.on('change', listener);
    return {
      dispose: () => {
        this.emitter.off('change', listener);
      },
    };
  }

  dispose(): void {
    this.emitter.removeAllListeners();
  }
}

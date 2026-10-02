import { describe, expect, it } from 'vitest';
import {
  daysLeft,
  IGNORE_KEY,
  IgnoreStore,
  MAX_REASON_LENGTH,
  type MementoLike,
  normalizeReason,
  reasonText,
  untilDate,
  validateReason,
} from '../../../src/panel/ignore.js';

const DAY = 86_400_000;

/** An in-memory memento that records every write. */
function fakeMemento(initial?: unknown): MementoLike & { value: unknown; writes: number } {
  return {
    value: initial,
    writes: 0,
    get(key: string) {
      return key === IGNORE_KEY ? this.value : undefined;
    },
    update(key: string, value: unknown) {
      if (key === IGNORE_KEY) this.value = value;
      this.writes += 1;
      return Promise.resolve();
    },
  };
}

function setup(start = Date.UTC(2026, 8, 30)) {
  const memento = fakeMemento();
  const clock = { now: start };
  const store = new IgnoreStore(memento, () => clock.now);
  return { memento, clock, store };
}

describe('IgnoreStore', () => {
  it('ignores a path for 90 days with a trimmed reason and tells listeners', async () => {
    const { memento, clock, store } = setup();
    let changes = 0;
    const sub = store.onDidChange(() => (changes += 1));
    const entry = await store.add('src/a.ts', '  rewrite\n in Q4  ');
    expect(entry).toEqual({
      path: 'src/a.ts',
      reason: 'rewrite in Q4',
      until: clock.now + 90 * DAY,
    });
    expect(store.list()).toEqual([entry]);
    expect(store.has('src/a.ts')).toBe(true);
    expect(store.has('src/b.ts')).toBe(false);
    expect(memento.value).toEqual([entry]);
    expect(changes).toBe(1);
    sub.dispose();
    await store.add('src/b.ts', '');
    expect(changes).toBe(1);
  });

  it('expires at exactly `until`, and purges expired entries from storage on read', async () => {
    const { memento, clock, store } = setup();
    await store.add('a.ts', 'x', 1);
    await store.add('b.ts', 'y', 2);
    clock.now += DAY - 1;
    expect(store.list().map((e) => e.path)).toEqual(['a.ts', 'b.ts']);
    clock.now += 1; // exactly a.ts's until
    const writes = memento.writes;
    expect(store.list().map((e) => e.path)).toEqual(['b.ts']);
    expect(memento.writes).toBe(writes + 1);
    expect(memento.value).toEqual([expect.objectContaining({ path: 'b.ts' })]);
    expect(store.list().map((e) => e.path)).toEqual(['b.ts']);
    expect(memento.writes).toBe(writes + 1); // nothing more to purge, nothing written
  });

  it('drops malformed stored values', () => {
    const memento = fakeMemento([
      { path: 'ok.ts', reason: 'fine', until: Number.MAX_SAFE_INTEGER },
      { path: '../escape.ts', reason: '', until: Number.MAX_SAFE_INTEGER },
      { path: 'x.ts', reason: 'x'.repeat(MAX_REASON_LENGTH + 1), until: Number.MAX_SAFE_INTEGER },
      { path: 'y.ts', until: Number.MAX_SAFE_INTEGER },
      'z.ts',
      null,
    ]);
    const store = new IgnoreStore(memento);
    expect(store.list().map((e) => e.path)).toEqual(['ok.ts']);
    expect(new IgnoreStore(fakeMemento('not a list')).list()).toEqual([]);
    expect(new IgnoreStore(fakeMemento()).list()).toEqual([]);
  });

  it('is idempotent: ignoring again replaces the entry, never duplicates it', async () => {
    const { clock, store } = setup();
    await store.add('a.ts', 'first');
    clock.now += DAY;
    await store.add('a.ts', 'second');
    expect(store.list()).toEqual([{ path: 'a.ts', reason: 'second', until: clock.now + 90 * DAY }]);
  });

  it('removes, and reports whether anything was removed', async () => {
    const { store } = setup();
    await store.add('a.ts', '');
    let changes = 0;
    store.onDidChange(() => (changes += 1));
    expect(await store.remove('b.ts')).toBe(false);
    expect(changes).toBe(0);
    expect(await store.remove('a.ts')).toBe(true);
    expect(store.list()).toEqual([]);
    expect(changes).toBe(1);
    store.dispose();
  });

  it('refuses paths that are not repository-relative', async () => {
    const { store } = setup();
    await expect(store.add('/etc/passwd', '')).rejects.toThrow();
    await expect(store.add('../x', '')).rejects.toThrow();
  });
});

describe('ignore helpers', () => {
  it('normalises and validates reasons', () => {
    expect(normalizeReason('  a \t b ')).toBe('a b');
    expect(normalizeReason('x'.repeat(300))).toHaveLength(MAX_REASON_LENGTH);
    expect(validateReason('x'.repeat(MAX_REASON_LENGTH))).toBeUndefined();
    expect(validateReason(`  ${'x'.repeat(MAX_REASON_LENGTH)}  `)).toBeUndefined();
    expect(validateReason('x'.repeat(MAX_REASON_LENGTH + 1))).toMatch(/200/);
  });

  it('words the reason, days left and expiry', () => {
    const now = Date.UTC(2026, 8, 30);
    const entry = { path: 'a.ts', reason: '', until: now + 89.2 * DAY };
    expect(reasonText(entry)).toBe('no reason given');
    expect(reasonText({ ...entry, reason: 'why' })).toBe('why');
    expect(daysLeft(entry, now)).toBe(90);
    expect(daysLeft(entry, entry.until + 1)).toBe(0);
    expect(untilDate({ ...entry, until: Date.UTC(2026, 11, 28, 5) })).toBe('2026-12-28');
  });
});

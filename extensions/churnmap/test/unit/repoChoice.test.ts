import { describe, expect, it } from 'vitest';
import type { RepoCandidate } from '../../src/analysis/discover.js';
import {
  chooseRepository,
  deepestContaining,
  isMostlyDocumentation,
  MIN_CODE_FILES,
  mostlyDocsActions,
  RANK_ALL_ACTION,
  SELECT_REPOSITORY_ACTION,
  pickItems,
  recommend,
  relativeTo,
} from '../../src/repoChoice.js';

const W = '/w/Acme';
const repo = (root: string, over: Partial<RepoCandidate> = {}): RepoCandidate => ({
  root,
  name: root.split('/').at(-1) ?? root,
  isNested: root !== W,
  ...(root === W ? {} : { parentRoot: W }),
  workspaceFolder: W,
  ...over,
});

const UMBRELLA = repo(W);
const BACKEND = repo(`${W}/Acme-Backend`);
const FRONTEND = repo(`${W}/acme-frontend`);
const DOCS = repo(`${W}/acmekit-docs`);
const ACME = [UMBRELLA, BACKEND, FRONTEND, DOCS];

/** The umbrella and the docs repository are mostly documentation. */
const umbrellas = new Set([UMBRELLA.root, DOCS.root]);
const isUmbrella = (c: RepoCandidate): Promise<boolean> => Promise.resolve(umbrellas.has(c.root));

describe('deepestContaining', () => {
  it('picks the deepest repository around the file', () => {
    expect(deepestContaining(ACME, `${W}/acme-frontend/src/App.tsx`)).toBe(FRONTEND);
    expect(deepestContaining(ACME, `${W}/STATUS.md`)).toBe(UMBRELLA);
    expect(deepestContaining(ACME, '/elsewhere/file.ts')).toBeUndefined();
  });

  it('matches whole folder names only', () => {
    expect(deepestContaining(ACME, `${W}/acme-frontend-old/a.ts`)).toBe(UMBRELLA);
  });
});

describe('chooseRepository', () => {
  it('uses the active file’s deepest repository, without asking', async () => {
    const choice = await chooseRepository(ACME, {
      activeFile: `${W}/Acme-Backend/app/main.py`,
      remembered: FRONTEND.root,
      isUmbrella,
    });
    expect(choice).toEqual({ candidate: BACKEND, reason: 'active', ask: false });
  });

  it('never auto-picks the umbrella for a doc open in it while code repositories exist', async () => {
    const choice = await chooseRepository(ACME, {
      activeFile: `${W}/docs/STATUS_TRACKER.html`,
      isUmbrella,
    });
    expect(choice).toEqual({ candidate: BACKEND, reason: 'recommended', ask: true });
    expect(pickItems(ACME, { recommended: choice.candidate })[0]?.label).toBe('Acme-Backend');
  });

  it('with a doc of the umbrella open, a remembered choice still wins', async () => {
    const choice = await chooseRepository(ACME, {
      activeFile: `${W}/docs/STATUS_TRACKER.html`,
      remembered: FRONTEND.root,
      isUmbrella,
    });
    expect(choice).toEqual({ candidate: FRONTEND, reason: 'remembered', ask: false });
  });

  it('keeps an umbrella that is the only candidate (its empty state explains)', async () => {
    const choice = await chooseRepository([UMBRELLA], {
      activeFile: `${W}/docs/STATUS_TRACKER.html`,
      isUmbrella,
    });
    expect(choice).toEqual({ candidate: UMBRELLA, reason: 'active', ask: false });
  });

  it('falls back to the remembered choice when the active file is outside every repository', async () => {
    const choice = await chooseRepository(ACME, {
      activeFile: '/tmp/scratch.ts',
      remembered: FRONTEND.root,
      isUmbrella,
    });
    expect(choice).toEqual({ candidate: FRONTEND, reason: 'remembered', ask: false });
  });

  it('ignores a remembered repository that no longer exists', async () => {
    const choice = await chooseRepository(ACME, { remembered: '/w/gone', isUmbrella });
    expect(choice.reason).toBe('recommended');
  });

  it('recommends the first repository that is not an umbrella, and asks', async () => {
    const checked: string[] = [];
    const choice = await chooseRepository(ACME, {
      isUmbrella: (c) => {
        checked.push(c.name);
        return isUmbrella(c);
      },
    });
    expect(choice).toEqual({ candidate: BACKEND, reason: 'recommended', ask: true });
    // Stops at the first code repository: git ls-files runs no more than it must.
    expect(checked).toEqual(['Acme', 'Acme-Backend']);
  });

  it('falls back to the first candidate when every one is an umbrella', async () => {
    const choice = await chooseRepository([UMBRELLA, DOCS], {
      isUmbrella: () => Promise.resolve(true),
    });
    expect(choice).toEqual({ candidate: UMBRELLA, reason: 'recommended', ask: true });
  });

  it('uses the only candidate without asking, and reports none when there is none', async () => {
    expect(await chooseRepository([FRONTEND], { isUmbrella })).toEqual({
      candidate: FRONTEND,
      reason: 'only',
      ask: false,
    });
    expect(await chooseRepository([], { isUmbrella })).toEqual({
      candidate: undefined,
      reason: 'none',
      ask: false,
    });
  });

  it('treats a failing umbrella test as "not an umbrella"', async () => {
    const pick = await recommend([UMBRELLA, BACKEND], () => Promise.reject(new Error('git')));
    expect(pick).toBe(UMBRELLA);
  });
});

describe('pickItems', () => {
  it('lists the recommended repository first, marked, each with where it is', () => {
    expect(pickItems(ACME, { recommended: BACKEND, current: FRONTEND.root })).toEqual([
      {
        label: 'Acme-Backend',
        description: 'recommended',
        detail: 'Acme-Backend · nested repository',
        root: BACKEND.root,
      },
      {
        label: 'Acme',
        description: '',
        detail: 'Acme · workspace folder',
        root: UMBRELLA.root,
      },
      {
        label: 'acme-frontend',
        description: 'current',
        detail: 'acme-frontend · nested repository',
        root: FRONTEND.root,
      },
      {
        label: 'acmekit-docs',
        description: '',
        detail: 'acmekit-docs · nested repository',
        root: DOCS.root,
      },
    ]);
  });

  it('shows deeper nested paths relative to their workspace folder', () => {
    expect(relativeTo('/w', '/w/apps/web')).toBe('apps/web');
    expect(relativeTo('/w', '/w')).toBe('w');
  });
});

describe('the empty state', () => {
  const files = (eligible: number, other = 10) => [
    ...Array.from({ length: eligible }, () => ({ eligible: true })),
    ...Array.from({ length: other }, () => ({ eligible: false })),
  ];

  it(`shows with rank: code when fewer than ${String(MIN_CODE_FILES)} files rank`, () => {
    expect(isMostlyDocumentation(files(0), 'code')).toBe(true);
    expect(isMostlyDocumentation(files(2), 'code')).toBe(true);
    expect(isMostlyDocumentation(files(3), 'code')).toBe(false);
  });

  it('never shows with rank: all', () => {
    expect(isMostlyDocumentation(files(0), 'all')).toBe(false);
  });
});

describe('mostlyDocsActions', () => {
  it('offers "Rank all files" only after the repository question was shown', () => {
    expect(mostlyDocsActions(false)).toEqual([SELECT_REPOSITORY_ACTION]);
    expect(mostlyDocsActions(true)).toEqual([SELECT_REPOSITORY_ACTION, RANK_ALL_ACTION]);
  });
});

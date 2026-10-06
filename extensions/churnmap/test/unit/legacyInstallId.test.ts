import { describe, expect, it, vi } from 'vitest';
import { clearLegacyInstallId, LEGACY_INSTALL_ID_KEY } from '../../src/legacyInstallId.js';

function memento(initial: Record<string, unknown>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: (key: string): unknown => data.get(key),
    update: vi.fn((key: string) => {
      data.delete(key);
      return Promise.resolve();
    }),
  };
}

describe('clearLegacyInstallId', () => {
  it('uses the key labs-core telemetry wrote', () => {
    expect(LEGACY_INSTALL_ID_KEY).toBe('labs.installId');
  });

  it('clears the old install id and leaves other keys alone', async () => {
    const state = memento({ [LEGACY_INSTALL_ID_KEY]: 'a-uuid', 'churnmap.coach': true });
    await expect(clearLegacyInstallId(state)).resolves.toBe(true);
    expect(state.update).toHaveBeenCalledTimes(1);
    expect(state.update).toHaveBeenCalledWith(LEGACY_INSTALL_ID_KEY, undefined);
    expect([...state.data.entries()]).toEqual([['churnmap.coach', true]]);
  });

  it('writes nothing when there is no install id', async () => {
    const state = memento({ 'churnmap.coach': true });
    await expect(clearLegacyInstallId(state)).resolves.toBe(false);
    expect(state.update).not.toHaveBeenCalled();
    expect([...state.data.entries()]).toEqual([['churnmap.coach', true]]);
  });
});

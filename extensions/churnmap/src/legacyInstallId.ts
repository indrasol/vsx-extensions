/**
 * Churnmap 1.0.0 and 1.0.1 stored a random install id for telemetry that was never sent. The
 * telemetry code is gone; this clears that leftover key once and stores nothing in its place.
 * No `vscode` import, so the unit tests can load it.
 */
export const LEGACY_INSTALL_ID_KEY = 'labs.installId';

/** The slice of `vscode.Memento` this needs. */
export interface LegacyState {
  get(key: string): unknown;
  update(key: string, value: undefined): Thenable<void>;
}

/** Clears the old install id if present. Resolves true when it removed one. */
export async function clearLegacyInstallId(state: LegacyState): Promise<boolean> {
  if (state.get(LEGACY_INSTALL_ID_KEY) === undefined) return false;
  await state.update(LEGACY_INSTALL_ID_KEY, undefined);
  return true;
}

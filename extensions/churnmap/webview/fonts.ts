/** The UI type stack: modern system fonts only (the CSP allows no font files, ADR-0011). */
export const UI_FONT =
  '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

/** The editor's font for paths, with a monospace fallback. */
export function codeFont(): string {
  const family = getComputedStyle(document.body)
    .getPropertyValue('--vscode-editor-font-family')
    .trim();
  return family ? `${family}, ui-monospace, monospace` : 'ui-monospace, monospace';
}

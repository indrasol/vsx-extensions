// Types for readme-tables.mjs, so the TypeScript unit tests can use it.
export const COMMAND_SUMMARIES: Record<string, string>;
export const MARKERS: { settings: string[]; commands: string[] };
export function settingsTable(manifest: unknown): string;
export function commandsTable(manifest: unknown): string;
export function paletteCommands(manifest: unknown): { command: string; title: string }[];
export function withTables(readme: string, manifest: unknown): string;
export function tableCells(text: string, markers: string[]): string[][];

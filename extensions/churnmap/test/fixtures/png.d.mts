// Types for png.mjs, so TypeScript tests can use it.
export function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array };

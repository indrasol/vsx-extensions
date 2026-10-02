// Types for third-party-notices.mjs, so the TypeScript unit tests can use it.
export interface BundledPackage {
  name: string;
  version: string;
  license: string;
  dir: string;
}
export const OUTPUT: string;
export const ALLOWED: Set<string>;
export const NOTES: Record<string, string>;
export function packageDirOf(input: string): string | undefined;
export function bundledPackages(inputs: string[]): BundledPackage[];
export function render(packages: BundledPackage[]): { text: string; problems: string[] };

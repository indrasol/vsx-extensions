export interface CatalogEntry {
  /** Full extension id, `Indrasol.<kebab-name>` (ADR-0008). */
  id: string;
  displayName: string;
  tagline: string;
  marketplaceUrl: string;
  openVsxUrl: string;
}

export type Catalog = readonly CatalogEntry[];

/** Published Indrasol Labs extensions. Empty until the first one ships. */
export const CATALOG: Catalog = [];

export const ALL_EXTENSIONS_URL = 'https://indrasol.com/labs';

export const LABS = 'indrasol-labs' as const;

export { createLogger } from './logger.js';
export type { Logger, LoggerOptions } from './logger.js';
export { registerMoreFromLabsView } from './moreFromLabs.js';
export type { MoreFromLabsLink, MoreFromLabsOptions } from './moreFromLabs.js';
export type { Catalog, CatalogEntry } from './catalog.js';

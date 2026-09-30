export const LABS = 'indrasol-labs' as const;

export { createLogger } from './logger.js';
export type { Logger, LoggerOptions } from './logger.js';
export { createTelemetry, scrub } from './telemetry.js';
export type {
  Telemetry,
  TelemetryEvent,
  TelemetryOptions,
  TelemetryProperties,
  TelemetryTransport,
} from './telemetry.js';
export { registerMoreFromLabsView } from './moreFromLabs.js';
export type { MoreFromLabsLink, MoreFromLabsOptions } from './moreFromLabs.js';
export type { Catalog, CatalogEntry } from './catalog.js';

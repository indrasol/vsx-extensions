import { createTelemetry as createLabsTelemetry, type Telemetry } from '@indrasol/labs-core';
import type * as vscode from 'vscode';

interface ManifestIdentity {
  version: string;
}

function isManifestIdentity(value: unknown): value is ManifestIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof value.version === 'string'
  );
}

/**
 * The labs-core telemetry for this extension. No-op by default: telemetry is off in v1 (ADR-0006).
 * Every event is listed in telemetry.json.
 */
export function createTelemetry(context: vscode.ExtensionContext): Telemetry {
  const manifest: unknown = context.extension.packageJSON;
  const version = isManifestIdentity(manifest) ? manifest.version : '0.0.0';
  return createLabsTelemetry(context, { extensionId: context.extension.id, version });
}

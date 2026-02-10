/**
 * Provider registry — maps ServerType to its provider implementation.
 *
 * Single source of truth for which server types are supported.
 * Zod schemas and frontend should reference SUPPORTED_SERVER_TYPES.
 */

import type { ServerType } from '@mc-server-manager/shared';
import type { ServerProvider } from './provider.js';

const providers = new Map<ServerType, ServerProvider>();

/**
 * Register a provider for a server type.
 * Called at module initialization (e.g., in the vanilla/paper/fabric provider files).
 */
export function registerProvider(provider: ServerProvider): void {
  if (providers.has(provider.type)) {
    throw new Error(`Provider for '${provider.type}' is already registered`);
  }
  providers.set(provider.type, provider);
}

/**
 * Get the provider for a server type.
 * Throws if the type has no registered provider.
 */
export function getProvider(type: ServerType): ServerProvider {
  const provider = providers.get(type);
  if (!provider) {
    throw new Error(`No provider registered for server type '${type}'`);
  }
  return provider;
}

/**
 * Check if a provider is registered for a server type.
 */
export function hasProvider(type: ServerType): boolean {
  return providers.has(type);
}

/**
 * Get all registered server types.
 * This is the single source of truth for supported types at runtime.
 */
export function getSupportedServerTypes(): ServerType[] {
  return [...providers.keys()];
}

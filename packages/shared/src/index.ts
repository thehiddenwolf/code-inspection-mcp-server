// @hermes/shared — barrel exports
export * from './schemas/tools.js';
export * from './schemas/manifests.js';
export * from './schemas/patterns.js';
export * from './schemas/events.js';
export * from './schemas/violations.js';
export * from './schemas/language-pack.js';
export * from './schemas/server-config.js';
export * from './types/mcp.js';
export * from './types/tools.js';
export * from './types/language-pack.js';
export * from './types/server-config.js';
export * from './utils/logging.js';
export * from './utils/idempotency.js';
export * from './utils/language-pack-loader.js';
export * from './utils/config-loader.js';

/** Package metadata */
export const PACKAGE_VERSION = '0.1.0';
export const PACKAGE_NAME = '@hermes/shared';
export * from './default-packs.js';

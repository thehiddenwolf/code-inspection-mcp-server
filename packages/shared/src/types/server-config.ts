/**
 * @hermes/shared — Server Configuration Types
 *
 * Defines the schema types for the unified hermes-config.json.
 */

export interface ServerConfig {
  /** Language pack references (NPM packages, git repositories, or file/folder paths) */
  languagePacks?: string[];
}

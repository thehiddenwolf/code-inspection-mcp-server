import { z } from 'zod';

/**
 * Architecture manifest — defines the structural blueprint of a codebase.
 */

export const ManifestMetadata = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
});
export type ManifestMetadataType = z.infer<typeof ManifestMetadata>;

export const ManifestComponent: z.ZodObject<any> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['module', 'class', 'function', 'interface', 'type', 'file', 'directory']),
  path: z.string().optional(),
  description: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  children: z.array(z.lazy((): z.ZodTypeAny => ManifestComponent)).optional(),
});
export type ManifestComponentType = z.infer<typeof ManifestComponent>;

export const ManifestRelationship = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(['imports', 'extends', 'implements', 'composes', 'depends_on']),
  description: z.string().optional(),
});
export type ManifestRelationshipType = z.infer<typeof ManifestRelationship>;

export const ArchitectureManifest = z.object({
  schema: z.literal('hermes-arch-manifest-v1'),
  metadata: ManifestMetadata,
  components: z.array(ManifestComponent),
  relationships: z.array(ManifestRelationship).optional(),
  invariants: z.array(z.string()).optional(),
});
export type ArchitectureManifestType = z.infer<typeof ArchitectureManifest>;

export const ManifestValidationResult = z.object({
  valid: z.boolean(),
  violations: z.array(
    z.object({
      rule: z.string(),
      message: z.string(),
      path: z.string().optional(),
      severity: z.enum(['error', 'warning', 'info']),
    }),
  ),
  warnings: z.array(z.string()),
});
export type ManifestValidationResultType = z.infer<typeof ManifestValidationResult>;

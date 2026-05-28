/**
 * ArchitectureShepherd — unit tests
 */

import { describe, it, expect } from 'vitest';
import { parseManifest, getLayerForPath, isImportAllowed } from '../src/manifest-parser.js';
import type { Manifest } from '../src/manifest-parser.js';
import { checkDiff } from '../src/diff-checker.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Fixtures ────────────────────────────────────────────────────────────────

const VALID_MANIFEST_MD = fs.readFileSync(
  path.resolve(__dirname, 'fixtures', 'ARCHITECTURE.md'),
  'utf-8',
);

const EMPTY_MANIFEST = '';

const UNPARSEABLE_MANIFEST = `
# Random Document
This is just a regular markdown file with no architecture structure.

- some list items
- that don't match anything
`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('manifest-parser', () => {
  it('should parse a valid ARCHITECTURE.md manifest', () => {
    const manifest = parseManifest(VALID_MANIFEST_MD);

    expect(manifest).toBeDefined();
    expect(manifest.layers).toHaveLength(3);
    expect(manifest.components).toHaveLength(6);
    expect(manifest.boundaries).toHaveLength(2);

    // Check layers
    const presentation = manifest.layers.find((l) => l.name === 'presentation');
    expect(presentation).toBeDefined();
    expect(presentation!.dependsOn).toEqual(['domain']);

    const domain = manifest.layers.find((l) => l.name === 'domain');
    expect(domain).toBeDefined();
    expect(domain!.dependsOn).toEqual([]);

    const infra = manifest.layers.find((l) => l.name === 'infrastructure');
    expect(infra).toBeDefined();
    expect(infra!.dependsOn).toEqual(['domain']);

    // Check components
    expect(manifest.components).toContainEqual({ path: 'packages/web-app', layer: 'presentation' });
    expect(manifest.components).toContainEqual({ path: 'packages/core', layer: 'domain' });
    expect(manifest.components).toContainEqual({ path: 'src/domain', layer: 'domain' });

    // Check boundaries
    expect(manifest.boundaries[0].description).toBe('presentation must not import infrastructure directly');
  });

  it('should handle empty manifest gracefully', () => {
    const manifest = parseManifest(EMPTY_MANIFEST);

    expect(manifest).toBeDefined();
    expect(manifest.layers).toHaveLength(0);
    expect(manifest.components).toHaveLength(0);
    expect(manifest.boundaries).toHaveLength(0);
  });

  it('should handle unparseable manifest gracefully', () => {
    const manifest = parseManifest(UNPARSEABLE_MANIFEST);

    expect(manifest).toBeDefined();
    expect(manifest.layers).toHaveLength(0);
    expect(manifest.components).toHaveLength(0);
    expect(manifest.boundaries).toHaveLength(0);
  });
});

describe('getLayerForPath', () => {
  const manifest: Manifest = {
    name: 'test',
    layers: [
      { name: 'presentation', dependsOn: ['domain'] },
      { name: 'domain', dependsOn: [] },
      { name: 'infrastructure', dependsOn: ['domain'] },
    ],
    components: [
      { path: 'packages/web-app', layer: 'presentation' },
      { path: 'packages/core', layer: 'domain' },
      { path: 'packages/api', layer: 'infrastructure' },
      { path: 'src/web', layer: 'presentation' },
      { path: 'src/domain', layer: 'domain' },
      { path: 'src/infra', layer: 'infrastructure' },
    ],
    boundaries: [],
  };

  it('should map file paths via component prefix match', () => {
    expect(getLayerForPath('packages/web-app/src/components/Button.tsx', manifest)).toBe('presentation');
    expect(getLayerForPath('packages/core/src/models/User.ts', manifest)).toBe('domain');
    expect(getLayerForPath('packages/api/src/routes.ts', manifest)).toBe('infrastructure');
    expect(getLayerForPath('src/web/pages/Home.tsx', manifest)).toBe('presentation');
    expect(getLayerForPath('src/domain/entities.ts', manifest)).toBe('domain');
    expect(getLayerForPath('src/infra/database.ts', manifest)).toBe('infrastructure');
  });

  it('should return null for unmapped paths', () => {
    expect(getLayerForPath('some/random/file.ts', manifest)).toBeNull();
    expect(getLayerForPath('node_modules/foo/index.js', manifest)).toBeNull();
  });
});

describe('isImportAllowed', () => {
  const manifest: Manifest = {
    name: 'test',
    layers: [
      { name: 'presentation', dependsOn: ['domain'] },
      { name: 'domain', dependsOn: [] },
      { name: 'infrastructure', dependsOn: ['domain'] },
    ],
    components: [],
    boundaries: [],
  };

  it('should allow same-layer imports', () => {
    expect(isImportAllowed('domain', 'domain', manifest)).toBe(true);
    expect(isImportAllowed('presentation', 'presentation', manifest)).toBe(true);
  });

  it('should allow allowed cross-layer imports', () => {
    expect(isImportAllowed('presentation', 'domain', manifest)).toBe(true);
    expect(isImportAllowed('infrastructure', 'domain', manifest)).toBe(true);
  });

  it('should reject disallowed cross-layer imports', () => {
    expect(isImportAllowed('domain', 'presentation', manifest)).toBe(false);
    expect(isImportAllowed('domain', 'infrastructure', manifest)).toBe(false);
    expect(isImportAllowed('presentation', 'infrastructure', manifest)).toBe(false);
  });
});

describe('diff-checker', () => {
  const manifest: Manifest = {
    name: 'test',
    layers: [
      { name: 'presentation', dependsOn: ['domain'] },
      { name: 'domain', dependsOn: [] },
      { name: 'infrastructure', dependsOn: ['domain'] },
    ],
    components: [
      { path: 'src/web', layer: 'presentation' },
      { path: 'src/domain', layer: 'domain' },
      { path: 'src/infra', layer: 'infrastructure' },
    ],
    boundaries: [],
  };

  it('should detect a layer boundary violation in a diff', () => {
    const diff = `diff --git a/src/web/controller.ts b/src/web/controller.ts
@@ -1,3 +1,5 @@
 import { DomainService } from '../domain/services';
+import { Database } from '../infra/database';
+import { Cache } from '../infra/cache';

 export class Controller {
   constructor(private svc: DomainService) {}`;

    const result = checkDiff(diff, manifest);

    expect(result.violations).toHaveLength(2);
    expect(result.violations[0].file).toBe('src/web/controller.ts');
    expect(result.violations[0].fromLayer).toBe('presentation');
    expect(result.violations[0].toLayer).toBe('infrastructure');
    expect(result.violations[0].importPath).toBe('../infra/database');
    expect(result.violations[1].importPath).toBe('../infra/cache');
  });

  it('should pass a diff with no violations', () => {
    const diff = `diff --git a/src/domain/entity.ts b/src/domain/entity.ts
@@ -1 +1,3 @@
+import { randomUUID } from 'node:crypto';
+
 export interface Entity {
   id: string;
 }`;

    const result = checkDiff(diff, manifest);

    expect(result.violations).toHaveLength(0);
    expect(result.filesChanged).toBe(1);
    expect(result.linesAdded).toBe(2);
  });

  it('should handle an empty diff', () => {
    const result = checkDiff('', manifest);
    expect(result.violations).toHaveLength(0);
    expect(result.filesChanged).toBe(0);
    expect(result.linesAdded).toBe(0);
  });
});

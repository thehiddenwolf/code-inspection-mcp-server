/**
 * Manifest parser for ArchitectureShepherd.
 * Parses ARCHITECTURE.md structured markdown into a typed Manifest object.
 */

import * as fs from 'node:fs';

// ── Types ───────────────────────────────────────────────────────────────────

export interface LayerDef {
  name: string;
  dependsOn: string[];
}

export interface ComponentMapping {
  path: string;
  layer: string;
}

export interface BoundaryRule {
  description: string;
}

export interface Manifest {
  name: string;
  layers: LayerDef[];
  components: ComponentMapping[];
  boundaries: BoundaryRule[];
}

// ── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse an ARCHITECTURE.md manifest from raw markdown content.
 */
export function parseManifest(content: string): Manifest {
  const manifest: Manifest = {
    name: '',
    layers: [],
    components: [],
    boundaries: [],
  };

  const lines = content.split('\n');
  let currentSection: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();

    // Detect sections
    const sectionMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase();
      continue;
    }

    // Also detect # Architecture as a top-level header
    const topSectionMatch = line.match(/^#\s+(.+)$/);
    if (topSectionMatch) {
      currentSection = topSectionMatch[1].toLowerCase();
      continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      const item = line.slice(2).trim();

      switch (currentSection) {
        case 'architecture':
        case 'layers': {
          const layerMatch = item.match(/^([\w-]+)\s*:\s*depends\s+on\s+\[([^\]]*)\]\s*$/);
          if (layerMatch) {
            const name = layerMatch[1];
            const deps = layerMatch[2]
              .split(',')
              .map((d) => d.trim())
              .filter(Boolean);
            manifest.layers.push({ name, dependsOn: deps });
          }
          break;
        }

        case 'components': {
          const compMatch = item.match(/^([\w./-]+)\s*:\s*(\w[\w-]*)$/);
          if (compMatch) {
            manifest.components.push({
              path: compMatch[1],
              layer: compMatch[2],
            });
          }
          break;
        }

        case 'boundaries': {
          manifest.boundaries.push({ description: item });
          break;
        }
      }
    }
  }

  // Infer name from first layer or set default
  if (manifest.layers.length > 0) {
    manifest.name = manifest.layers[0].name || 'unnamed';
  } else {
    manifest.name = 'unnamed';
  }

  return manifest;
}

/**
 * Load and parse an ARCHITECTURE.md manifest from a file path.
 */
export function loadManifestFromFile(filePath: string): Manifest {
  const content = fs.readFileSync(filePath, 'utf-8');
  return parseManifest(content);
}

/**
 * Derive a layer name from a file path based on component mappings or path conventions.
 * Checks explicit mappings first, then falls back to path-based heuristics.
 */
export function getLayerForPath(
  filePath: string,
  manifest: Manifest,
): string | null {
  // 1. Check explicit component path mappings (exact match or prefix)
  for (const comp of manifest.components) {
    if (filePath.startsWith(comp.path)) {
      return comp.layer;
    }
    // Also check if the component path starts with the file path (reverse)
    if (comp.path.startsWith(filePath)) {
      return comp.layer;
    }
  }

  // 2. Fallback: path-based heuristic
  // Look for patterns like packages/<layer>/, src/<layer>/
  const pathParts = filePath.split('/');
  for (const part of pathParts) {
    for (const layer of manifest.layers) {
      if (part === layer.name || part === `layer${layer.name}`) {
        return layer.name;
      }
    }
  }

  // 3. Check for segments matching layer names
  for (const layer of manifest.layers) {
    const pattern = new RegExp(`[/_]${layer.name}[/_]|^${layer.name}[/_]`);
    if (pattern.test(filePath)) {
      return layer.name;
    }
  }

  return null;
}

/**
 * Determine if a from-layer is allowed to import from a to-layer.
 */
export function isImportAllowed(
  fromLayer: string,
  toLayer: string,
  manifest: Manifest,
): boolean {
  if (fromLayer === toLayer) return true;

  const layerDef = manifest.layers.find((l) => l.name === fromLayer);
  if (!layerDef) return false;

  return layerDef.dependsOn.includes(toLayer);
}

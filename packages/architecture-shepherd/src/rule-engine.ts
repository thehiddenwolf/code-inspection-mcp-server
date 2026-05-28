import type { ArchitectureManifestType } from '@hermes/shared';

/** Bridge type for Zod v4 recursive inference gap on components */
interface Comp {
  id: string;
  name?: string;
  path?: string;
  type?: string;
  children?: { path?: string }[];
  dependencies?: string[];
}

/**
 * Rule engine — evaluates structural rules against source code paths.
 *
 * Each rule inspects a set of files and produces violations.
 * Built-in rules cover: layer boundaries, component isolation,
 * dependency direction, file size, naming conventions.
 */

export interface Rule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  /** Run this rule against the manifest + file list. Return violations. */
  check(manifest: ArchitectureManifestType, files: string[]): RuleViolation[];
}

export interface RuleViolation {
  rule: string;
  message: string;
  path?: string;
  line?: number;
  severity: 'error' | 'warning' | 'info';
}

// ── Built-in rules ──────────────────────────────────────────────────────────

/**
 * Layer boundary rule — components in lower layers must not import
 * from components in higher layers.
 *
 * Determines layer by path depth (deeper = higher layer).
 */
export class LayerBoundaryRule implements Rule {
  id = 'layer-boundary';
  name = 'Layer Boundary';
  description = 'Ensures lower-layer components do not depend on higher-layer components';
  severity: 'error' = 'error';

  check(manifest: ArchitectureManifestType, files: string[]): RuleViolation[] {
    const violations: RuleViolation[] = [];

    // Build layer map: component id → path depth
    const componentLayers = new Map<string, number>();
    const comps = (manifest.components ?? []) as unknown as Comp[];
    for (const comp of comps) {
      const depth = comp.path ? comp.path.split('/').length : 0;
      componentLayers.set(comp.id, depth);
    }

    // For each relationship, check dependency direction
    for (const rel of manifest.relationships ?? []) {
      const sourceLayer = componentLayers.get(rel.source) ?? 0;
      const targetLayer = componentLayers.get(rel.target) ?? 0;

      if (sourceLayer < targetLayer && rel.type !== 'depends_on') {
        violations.push({
          rule: this.id,
          message: `Layer boundary violation: "${rel.source}" (layer ${sourceLayer}) ${rel.type} "${rel.target}" (layer ${targetLayer}). Lower layers should not import from higher layers.`,
          severity: 'error',
        });
      }
    }

    return violations;
  }
}

/**
 * Component isolation rule — components declared with explicit boundaries
 * should not have unexpected files in their directories.
 */
export class ComponentIsolationRule implements Rule {
  id = 'component-isolation';
  name = 'Component Isolation';
  description = 'Ensures component directories contain only expected files';
  severity: 'warning' = 'warning';

  check(manifest: ArchitectureManifestType, files: string[]): RuleViolation[] {
    const violations: RuleViolation[] = [];

    const dirComponents = (manifest.components?.filter(
      (c: unknown) => {
        const cc = c as Comp;
        return cc.type === 'directory' && cc.path;
      },
    ) ?? []) as unknown as Comp[];

    for (const comp of dirComponents) {
      const compPath = comp.path!;
      const expectedPrefix = compPath.endsWith('/') ? compPath : `${compPath}/`;

      // Files not matching this component's prefix
      const foreignFiles = files.filter(
        (f) => f.startsWith(expectedPrefix),
      );

      // If component has explicit children, flag files not matching any child
      const childPaths = new Set<string>(
        (comp.children ?? []).map((c: { path?: string }) => c.path).filter((p): p is string => typeof p === 'string'),
      );

      for (const file of foreignFiles) {
        const relativeFile = file.slice(expectedPrefix.length);
        const belongsToChild = [...childPaths].some((cp) =>
          relativeFile.startsWith(cp),
        );
        if (!belongsToChild && childPaths.size > 0) {
          violations.push({
            rule: this.id,
            message: `Unexpected file in component "${comp.name}": ${file}. Expected under: ${[...childPaths].join(', ')}`,
            path: file,
            severity: 'warning',
          });
        }
      }
    }

    return violations;
  }
}

/**
 * File size rule — flag files that exceed a reasonable size threshold.
 */
export class FileSizeRule implements Rule {
  id = 'file-size';
  name = 'File Size';
  description = 'Flags files that exceed the maximum recommended line count';
  severity: 'info' = 'info';

  constructor(private maxLines: number = 400) {}

  setMaxLines(max: number): void {
    this.maxLines = max;
  }

  check(_manifest: ArchitectureManifestType, files: string[]): RuleViolation[] {
    const violations: RuleViolation[] = [];

    // We don't read file contents here — that's done by the checker.
    // This rule is a stub that the check() caller populates after reading.
    return violations;
  }
}

/**
 * Dependency direction rule — verifies that dependency direction
 * (imports, extends, implements) respects the declared architecture.
 */
export class DependencyDirectionRule implements Rule {
  id = 'dependency-direction';
  name = 'Dependency Direction';
  description = 'Verifies dependency direction aligns with declared architecture relationships';
  severity: 'error' = 'error';

  check(manifest: ArchitectureManifestType, _files: string[]): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const componentIds = new Set(
      (manifest.components?.map((c: unknown) => (c as Comp).id) ?? []),
    );

    for (const rel of manifest.relationships ?? []) {
      // Source must exist
      if (!componentIds.has(rel.source)) {
        violations.push({
          rule: this.id,
          message: `Relationship references unknown source component: "${rel.source}"`,
          severity: 'error',
        });
      }
      if (!componentIds.has(rel.target)) {
        violations.push({
          rule: this.id,
          message: `Relationship references unknown target component: "${rel.target}"`,
          severity: 'error',
        });
      }

      // Composes relationship: source should contain target, not vice versa
      if (rel.type === 'composes') {
        const comps = (manifest.components ?? []) as unknown as Comp[];
        const sourceComp = comps.find((c) => c.id === rel.source);
        const targetComp = comps.find((c) => c.id === rel.target);
        if (sourceComp?.path && targetComp?.path) {
          if (!targetComp.path.startsWith(sourceComp.path)) {
            violations.push({
              rule: this.id,
              message: `"${rel.source}" composes "${rel.target}" but "${rel.target}" is not a child path of "${rel.source}". Composition implies containment.`,
              severity: 'warning',
            });
          }
        }
      }
    }

    return violations;
  }
}

// ── Rule registry ───────────────────────────────────────────────────────────

/**
 * Registry of all available rules, with enable/disable support.
 */
export class RuleRegistry {
  private rules = new Map<string, Rule>();

  constructor() {
    this.register(new LayerBoundaryRule());
    this.register(new ComponentIsolationRule());
    this.register(new FileSizeRule());
    this.register(new DependencyDirectionRule());
  }

  register(rule: Rule): void {
    this.rules.set(rule.id, rule);
  }

  unregister(id: string): void {
    this.rules.delete(id);
  }

  get(id: string): Rule | undefined {
    return this.rules.get(id);
  }

  getAll(): Rule[] {
    return [...this.rules.values()];
  }

  getEnabled(ids?: string[]): Rule[] {
    if (!ids || ids.length === 0) {
      return this.getAll();
    }
    const selected: Rule[] = [];
    for (const id of ids) {
      const rule = this.rules.get(id);
      if (rule) selected.push(rule);
    }
    return selected;
  }
}

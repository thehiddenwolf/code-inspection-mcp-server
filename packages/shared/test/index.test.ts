import { describe, it, expect, vi } from 'vitest';

// ── Tools schemas ───────────────────────────────────────────────────────────
import {
  SqueezeInput,
  SqueezeOutput,
  LanguageEnum,
  AggressivenessEnum,
  OutputFormatEnum,
  ManifestInput,
  ManifestOutput,
  ScanInput,
  ScanOutput,
  RouteInput,
  RouteOutput,
  KnowledgeQueryInput,
  KnowledgeQueryOutput,
} from '../src/schemas/tools.js';

// ── Manifests schemas ───────────────────────────────────────────────────────
import {
  ArchitectureManifest,
  ManifestMetadata,
  ManifestComponent,
  ManifestRelationship,
  ManifestValidationResult,
} from '../src/schemas/manifests.js';

// ── Patterns schemas ────────────────────────────────────────────────────────
import {
  PatternDefinition,
  PatternCatalog,
  PatternMatch,
  DeadCodeResult,
} from '../src/schemas/patterns.js';

// ── Events schemas ──────────────────────────────────────────────────────────
import {
  ToolInvocationEvent,
  ToolResultEvent,
  ToolErrorEvent,
  ServerStartupEvent,
  McpEvent,
} from '../src/schemas/events.js';

// ── Violations schemas ──────────────────────────────────────────────────────
import {
  Violation,
  ViolationReport,
  ViolationSummary,
} from '../src/schemas/violations.js';

// ── Utils ───────────────────────────────────────────────────────────────────
import {
  generateIdempotencyKey,
  deriveIdempotencyKey,
  InMemoryIdempotencyStore,
  isExpired,
} from '../src/utils/idempotency.js';

// ── Types ───────────────────────────────────────────────────────────────────
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  TOOL_NAMESPACES,
  TransportType,
} from '../src/types/mcp.js';
import {
  LanguagePackRegistry,
  LanguagePack,
} from '../src/types/language-pack.js';
import {
  LanguagePackLoader,
  loadLanguagePacks,
  parseRegexString,
} from '../src/utils/language-pack-loader.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Tool Schemas
// ═══════════════════════════════════════════════════════════════════════════════

describe('LanguageEnum', () => {
  it('accepts valid languages', () => {
    expect(LanguageEnum.parse('typescript')).toBe('typescript');
    expect(LanguageEnum.parse('python')).toBe('python');
    expect(LanguageEnum.parse('go')).toBe('go');
  });

  it('rejects invalid languages', () => {
    expect(() => LanguageEnum.parse('rust')).toThrow();
    expect(() => LanguageEnum.parse('java')).toThrow();
  });
});

describe('AggressivenessEnum', () => {
  it('accepts valid levels', () => {
    expect(AggressivenessEnum.parse('conservative')).toBe('conservative');
    expect(AggressivenessEnum.parse('aggressive')).toBe('aggressive');
  });

  it('rejects invalid levels', () => {
    expect(() => AggressivenessEnum.parse('extreme')).toThrow();
  });
});

describe('SqueezeInput', () => {
  it('validates minimal input', () => {
    const result = SqueezeInput.parse({
      code: 'const x = 1;',
      language: 'typescript',
    });
    expect(result.code).toBe('const x = 1;');
    expect(result.language).toBe('typescript');
  });

  it('validates full input with options', () => {
    const result = SqueezeInput.parse({
      code: 'const x = 1;',
      language: 'typescript',
      options: {
        aggressiveness: 'aggressive',
        preserve_comments: false,
        max_tokens: 1000,
      },
    });
    expect(result.options?.aggressiveness).toBe('aggressive');
    expect(result.options?.max_tokens).toBe(1000);
  });

  it('rejects missing code', () => {
    expect(() => SqueezeInput.parse({ language: 'typescript' })).toThrow();
  });
});

describe('SqueezeOutput', () => {
  it('validates output shape', () => {
    const result = SqueezeOutput.parse({
      original: 'const x = 1;',
      squeezed: 'const x = 1;',
      original_tokens: 10,
      squeezed_tokens: 8,
      reduction_ratio: 0.2,
      aggressiveness: 'balanced',
      language: 'typescript',
    });
    expect(result.reduction_ratio).toBe(0.2);
  });

  it('rejects invalid reduction_ratio', () => {
    expect(() =>
      SqueezeOutput.parse({
        original: 'a',
        squeezed: 'a',
        original_tokens: 1,
        squeezed_tokens: 1,
        reduction_ratio: 1.5,
        aggressiveness: 'balanced',
        language: 'ts',
      }),
    ).toThrow();
  });
});

describe('OutputFormatEnum', () => {
  it('accepts valid formats', () => {
    expect(OutputFormatEnum.parse('text')).toBe('text');
    expect(OutputFormatEnum.parse('both')).toBe('both');
  });
});

describe('ManifestInput', () => {
  it('validates path input', () => {
    expect(ManifestInput.parse({ path: './ARCHITECTURE.md' }).path).toBe('./ARCHITECTURE.md');
  });

  it('validates content input', () => {
    expect(ManifestInput.parse({ content: '{}' }).content).toBe('{}');
  });

  it('accepts empty object', () => {
    expect(() => ManifestInput.parse({})).not.toThrow();
  });
});

describe('ScanInput', () => {
  it('validates code scan', () => {
    const result = ScanInput.parse({ code: 'function foo() {}' });
    expect(result.code).toBe('function foo() {}');
  });

  it('validates file path scan', () => {
    const result = ScanInput.parse({ file_path: './src/index.ts' });
    expect(result.file_path).toBe('./src/index.ts');
  });

  it('validates with patterns filter', () => {
    const result = ScanInput.parse({
      file_path: './src/index.ts',
      patterns: ['unused-exports', 'magic-numbers'],
    });
    expect(result.patterns).toHaveLength(2);
  });
});

describe('ScanOutput', () => {
  it('validates empty match list', () => {
    const result = ScanOutput.parse({ matches: [], duration_ms: 5 });
    expect(result.matches).toEqual([]);
    expect(result.duration_ms).toBe(5);
  });

  it('validates with matches', () => {
    const result = ScanOutput.parse({
      matches: [
        { pattern: 'no-console', line: 10, message: 'Unexpected console', severity: 'warning' },
      ],
      duration_ms: 12,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].pattern).toBe('no-console');
  });
});

describe('RouteInput', () => {
  it('validates minimal input', () => {
    const result = RouteInput.parse({ task_description: 'Add a new endpoint' });
    expect(result.task_description).toBe('Add a new endpoint');
  });

  it('validates with constraints', () => {
    const result = RouteInput.parse({
      task_description: 'Train a model',
      constraints: { max_cost: 5.0, max_time_ms: 30000 },
    });
    expect(result.constraints?.max_cost).toBe(5.0);
  });
});

describe('RouteOutput', () => {
  it('validates output', () => {
    const result = RouteOutput.parse({
      complexity: 'medium',
      recommended_model: 'claude-sonnet-4',
      estimated_cost: 0.5,
      estimated_tokens: 5000,
    });
    expect(result.complexity).toBe('medium');
  });

  it('validates with subtasks', () => {
    const result = RouteOutput.parse({
      complexity: 'complex',
      recommended_model: 'claude-opus-4',
      estimated_cost: 2.0,
      estimated_tokens: 20000,
      subtasks: [{ name: 'Parse input' }, { name: 'Process data', estimated_tokens: 10000 }],
    });
    expect(result.subtasks).toHaveLength(2);
  });
});

describe('KnowledgeQueryInput', () => {
  it('validates minimal input', () => {
    const result = KnowledgeQueryInput.parse({ query: 'How does X work?' });
    expect(result.query).toBe('How does X work?');
  });
});

describe('KnowledgeQueryOutput', () => {
  it('validates empty results', () => {
    const result = KnowledgeQueryOutput.parse({ results: [] });
    expect(result.results).toEqual([]);
  });

  it('validates with results', () => {
    const result = KnowledgeQueryOutput.parse({
      results: [{ content: 'X works by...' }],
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].relevance_score).toBeUndefined();
  });

  it('validates relevance score range', () => {
    expect(() =>
      KnowledgeQueryOutput.parse({
        results: [{ content: 'test', relevance_score: 1.5 }],
      }),
    ).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Manifest Schemas
// ═══════════════════════════════════════════════════════════════════════════════

describe('ManifestMetadata', () => {
  it('validates metadata', () => {
    const result = ManifestMetadata.parse({ name: 'my-project' });
    expect(result.name).toBe('my-project');
  });

  it('requires name', () => {
    expect(() => ManifestMetadata.parse({})).toThrow();
  });
});

describe('ManifestComponent', () => {
  it('validates component', () => {
    const result = ManifestComponent.parse({
      id: 'mod-1',
      name: 'API Module',
      type: 'module',
    });
    expect(result.id).toBe('mod-1');
  });
});

describe('ArchitectureManifest', () => {
  it('validates minimal manifest', () => {
    const result = ArchitectureManifest.parse({
      schema: 'hermes-arch-manifest-v1',
      metadata: { name: 'test' },
      components: [{ id: 'c1', name: 'Component 1', type: 'module' }],
    });
    expect(result.schema).toBe('hermes-arch-manifest-v1');
    expect(result.components).toHaveLength(1);
  });

  it('rejects wrong schema', () => {
    expect(() =>
      ArchitectureManifest.parse({
        schema: 'v2',
        metadata: { name: 'test' },
        components: [],
      }),
    ).toThrow();
  });
});

describe('ManifestValidationResult', () => {
  it('validates clean result', () => {
    const result = ManifestValidationResult.parse({
      valid: true,
      violations: [],
      warnings: [],
    });
    expect(result.valid).toBe(true);
  });

  it('validates violations', () => {
    const result = ManifestValidationResult.parse({
      valid: false,
      violations: [{ rule: 'layer-boundary', message: 'Cross-layer import', severity: 'error' }],
      warnings: [],
    });
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].severity).toBe('error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Pattern Schemas
// ═══════════════════════════════════════════════════════════════════════════════

describe('PatternDefinition', () => {
  it('validates pattern', () => {
    const result = PatternDefinition.parse({
      id: 'no-console',
      name: 'No console.log',
      description: 'Prevents console.log in production code',
      category: 'best_practice',
      severity: 'warning',
      languages: ['javascript', 'typescript'],
      pattern: 'console\\.(log|debug|info)\\(',
      message_template: 'Unexpected console.{{method}}() call',
    });
    expect(result.id).toBe('no-console');
    expect(result.languages).toContain('typescript');
  });
});

describe('PatternCatalog', () => {
  it('validates catalog', () => {
    const result = PatternCatalog.parse({
      version: '1.0.0',
      patterns: [],
    });
    expect(result.version).toBe('1.0.0');
  });
});

describe('PatternMatch', () => {
  it('validates match', () => {
    const result = PatternMatch.parse({
      pattern_id: 'no-console',
      pattern_name: 'No console.log',
      line: 42,
      message: 'Unexpected console.log()',
      severity: 'warning',
    });
    expect(result.pattern_id).toBe('no-console');
  });
});

describe('DeadCodeResult', () => {
  it('validates dead code finding', () => {
    const result = DeadCodeResult.parse({
      symbol: 'unusedFunction',
      kind: 'function',
      file_path: './src/util.ts',
      line: 15,
      reason: 'Never called anywhere',
      confidence: 0.95,
    });
    expect(result.confidence).toBe(0.95);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Event Schemas
// ═══════════════════════════════════════════════════════════════════════════════

describe('ToolInvocationEvent', () => {
  it('validates invocation event', () => {
    const result = ToolInvocationEvent.parse({
      event: 'tool.invocation',
      metadata: {
        tool_name: 'token_squeezer_squeeze',
        timestamp: '2026-05-27T00:00:00Z',
      },
      input: { code: 'test', language: 'typescript' },
    });
    expect(result.metadata.tool_name).toBe('token_squeezer_squeeze');
  });
});

describe('ToolResultEvent', () => {
  it('validates result event', () => {
    const result = ToolResultEvent.parse({
      event: 'tool.result',
      metadata: {
        tool_name: 'token_squeezer_squeeze',
        timestamp: '2026-05-27T00:00:00Z',
      },
      output: 'squeezed result',
    });
    expect(result.is_error).toBe(false);
  });
});

describe('ToolErrorEvent', () => {
  it('validates error event', () => {
    const result = ToolErrorEvent.parse({
      event: 'tool.error',
      metadata: {
        tool_name: 'token_squeezer_squeeze',
        timestamp: '2026-05-27T00:00:00Z',
      },
      code: 'PARSE_ERROR',
      message: 'Failed to parse input',
    });
    expect(result.code).toBe('PARSE_ERROR');
  });
});

describe('ServerStartupEvent', () => {
  it('validates startup event', () => {
    const result = ServerStartupEvent.parse({
      event: 'server.startup',
      metadata: {
        server_name: 'code-inspection-mcp-gateway',
        timestamp: '2026-05-27T00:00:00Z',
        transport: 'stdio',
      },
    });
    expect(result.metadata.server_name).toBe('code-inspection-mcp-gateway');
  });

  it('rejects missing server_name', () => {
    expect(() =>
      ServerStartupEvent.parse({
        event: 'server.startup',
        metadata: { timestamp: '2026-05-27T00:00:00Z', transport: 'stdio' },
      }),
    ).toThrow();
  });
});

describe('McpEvent (discriminated union)', () => {
  it('routes invocation events correctly', () => {
    const event = McpEvent.parse({
      event: 'tool.invocation',
      metadata: { tool_name: 'test', timestamp: '2026-05-27T00:00:00Z' },
      input: {},
    });
    expect(event.event).toBe('tool.invocation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Violation Schemas
// ═══════════════════════════════════════════════════════════════════════════════

describe('Violation', () => {
  it('validates violation with single location', () => {
    const result = Violation.parse({
      rule_id: 'SRP-001',
      rule_name: 'Single Responsibility',
      severity: 'error',
      message: 'Class has multiple responsibilities',
      locations: [{ file: './src/service.ts', line: 10 }],
      category: 'solid_srp',
    });
    expect(result.rule_id).toBe('SRP-001');
  });
});

describe('ViolationSummary', () => {
  it('validates summary', () => {
    const result = ViolationSummary.parse({
      total_violations: 5,
      by_severity: { critical: 0, error: 2, warning: 3, info: 0 },
      by_category: { solid_srp: 2, naming: 3 },
      passed: false,
    });
    expect(result.total_violations).toBe(5);
    expect(result.passed).toBe(false);
  });
});

describe('ViolationReport', () => {
  it('validates full report', () => {
    const result = ViolationReport.parse({
      scan_id: 'scan-001',
      timestamp: '2026-05-27T00:00:00Z',
      target: './src/',
      violations: [],
      summary: {
        total_violations: 0,
        by_severity: { critical: 0, error: 0, warning: 0, info: 0 },
        by_category: {},
        passed: true,
      },
    });
    expect(result.scan_id).toBe('scan-001');
    expect(result.summary.passed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateIdempotencyKey', () => {
  it('generates a UUID', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('generates unique keys', () => {
    const k1 = generateIdempotencyKey();
    const k2 = generateIdempotencyKey();
    expect(k1).not.toBe(k2);
  });
});

describe('deriveIdempotencyKey', () => {
  it('derives deterministic key from tool + input', () => {
    const k1 = deriveIdempotencyKey('squeeze', { code: 'test', language: 'ts' });
    const k2 = deriveIdempotencyKey('squeeze', { code: 'test', language: 'ts' });
    expect(k1).toBe(k2);
  });

  it('produces different keys for different inputs', () => {
    const k1 = deriveIdempotencyKey('squeeze', { code: 'a' });
    const k2 = deriveIdempotencyKey('squeeze', { code: 'b' });
    expect(k1).not.toBe(k2);
  });

  it('keys start with idem- prefix', () => {
    const key = deriveIdempotencyKey('test', {});
    expect(key.startsWith('idem-')).toBe(true);
  });
});

describe('InMemoryIdempotencyStore', () => {
  it('stores and retrieves values', async () => {
    const store = new InMemoryIdempotencyStore();
    await store.set('key1', { result: 'done' });
    const entry = await store.get('key1');
    expect(entry).not.toBeNull();
    expect((entry as { result: unknown; timestamp: number }).result).toEqual({ result: 'done' });
  });

  it('returns null for unknown keys', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.get('nonexistent')).toBeNull();
  });
});

describe('isExpired', () => {
  it('returns true for old timestamps', () => {
    expect(isExpired(Date.now() - 9999999, 100)).toBe(true);
  });

  it('returns false for recent timestamps', () => {
    expect(isExpired(Date.now(), 100000)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Type Exports
// ═══════════════════════════════════════════════════════════════════════════════

describe('TOOL_NAMESPACES', () => {
  it('defines all tool namespaces', () => {
    expect(TOOL_NAMESPACES.TOKEN_SQUEEZER).toBe('token_squeezer');
    expect(TOOL_NAMESPACES.ARCHITECTURE_SHEPHERD).toBe('architecture_shepherd');
    expect(TOOL_NAMESPACES.REPOGRAPH).toBe('repograph');
  });
});

describe('TransportType', () => {
  it('defines all transports', () => {
    expect(TransportType.Stdio).toBe('stdio');
    expect(TransportType.SSE).toBe('sse');
  });
});

describe('LanguagePackRegistry', () => {
  it('is a singleton by default and allows setting/getting instance', () => {
    const r1 = LanguagePackRegistry.getInstance();
    const r2 = LanguagePackRegistry.getInstance();
    expect(r1).toBe(r2);

    const customRegistry = new LanguagePackRegistry();
    LanguagePackRegistry.setInstance(customRegistry);
    expect(LanguagePackRegistry.getInstance()).toBe(customRegistry);

    // Reset back
    LanguagePackRegistry.setInstance(r1);
  });

  it('registers and retrieves packs by extension (with normalization)', () => {
    const registry = new LanguagePackRegistry();
    const mockPack: LanguagePack = {
      metadata: {
        name: 'test-pack',
        version: '1.0.0',
        fileExtensions: ['.ts', 'tsx', 'JS']
      },
      parserName: 'test-parser'
    };

    registry.register(mockPack);

    // Lookup with exact match
    expect(registry.lookup('.ts')).toBe(mockPack);
    // Lookup with case-insensitivity
    expect(registry.lookup('.TS')).toBe(mockPack);
    // Lookup without leading dot
    expect(registry.lookup('ts')).toBe(mockPack);
    // Lookup with case-insensitivity and no leading dot
    expect(registry.lookup('tsx')).toBe(mockPack);
    expect(registry.lookup('.js')).toBe(mockPack);

    // Lookup non-existent
    expect(registry.lookup('.py')).toBeUndefined();
  });

  it('handles registering a pack with no file extensions', () => {
    const registry = new LanguagePackRegistry();
    const mockPack: any = {
      metadata: {
        name: 'no-ext-pack',
        version: '1.0.0'
      },
      parserName: 'test-parser'
    };
    registry.register(mockPack);
    expect(registry.getAll()).toHaveLength(0);
  });

  it('returns all unique registered packs via getAll', () => {
    const registry = new LanguagePackRegistry();
    const mockPack1: LanguagePack = {
      metadata: {
        name: 'pack1',
        version: '1.0.0',
        fileExtensions: ['.ts', '.tsx']
      },
      parserName: 'parser1'
    };
    const mockPack2: LanguagePack = {
      metadata: {
        name: 'pack2',
        version: '1.0.0',
        fileExtensions: ['.py']
      },
      parserName: 'parser2'
    };

    registry.register(mockPack1);
    registry.register(mockPack2);

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all).toContain(mockPack1);
    expect(all).toContain(mockPack2);
  });

  it('handles overlapping extensions with last-wins behavior', () => {
    const registry = new LanguagePackRegistry();
    const pack1: LanguagePack = {
      metadata: { name: 'ts1', version: '1.0.0', fileExtensions: ['.ts'] },
      parserName: 'parser1'
    };
    const pack2: LanguagePack = {
      metadata: { name: 'ts2', version: '1.0.0', fileExtensions: ['.ts'] },
      parserName: 'parser2'
    };

    registry.register(pack1);
    expect(registry.lookup('.ts')).toBe(pack1);

    registry.register(pack2);
    expect(registry.lookup('.ts')).toBe(pack2);
  });
});

describe('LanguagePackLoader', () => {
  it('loads valid language pack from string and compiles regexes', () => {
    const validJson = JSON.stringify({
      metadata: {
        name: 'typescript',
        version: '1.0.0',
        fileExtensions: ['.ts', '.tsx']
      },
      parserName: 'tree-sitter-typescript',
      regexPatterns: {
        commentDetection: '//.*|/\\*[\\s\\S]*?\\*/',
        importExtraction: '/^import\\s+/gm',
        exportExtraction: '/^export\\s+/gm'
      }
    });

    const pack = LanguagePackLoader.loadFromString(validJson);
    expect(pack.metadata.name).toBe('typescript');
    expect(pack.parserName).toBe('tree-sitter-typescript');
    expect(pack.regexPatterns?.commentDetection).toBeInstanceOf(RegExp);
    expect(pack.regexPatterns?.commentDetection.source).toBe('\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/');
    expect(pack.regexPatterns?.importExtraction).toBeInstanceOf(RegExp);
    expect(pack.regexPatterns?.importExtraction.source).toBe('^import\\s+');
    expect(pack.regexPatterns?.importExtraction.flags).toBe('gm');
    expect(pack.regexPatterns?.exportExtraction).toBeInstanceOf(RegExp);
    expect(pack.regexPatterns?.exportExtraction.source).toBe('^export\\s+');
    expect(pack.regexPatterns?.exportExtraction.flags).toBe('gm');
  });

  it('loads rules correctly from string', () => {
    const json = JSON.stringify({
      metadata: { name: 'test', version: '1.0.0', fileExtensions: ['.test'] },
      parserName: 'test-parser',
      rules: {
        comment: { action: 'document', maxLines: 5 },
        import: { action: 'shrink', unusedOnly: true }
      }
    });
    const pack = LanguagePackLoader.loadFromString(json);
    expect(pack.rules?.comment?.action).toBe('document');
    expect(pack.rules?.comment?.maxLines).toBe(5);
    expect(pack.rules?.import?.action).toBe('shrink');
    expect(pack.rules?.import?.unusedOnly).toBe(true);
  });

  it('loads squeezer rules correctly from string', () => {
    const json = JSON.stringify({
      metadata: { name: 'test', version: '1.0.0', fileExtensions: ['.test'] },
      parserName: 'test-parser',
      squeezer: {
        bodyPlaceholder: '{ /* body */ }',
        bodyPatterns: [
          { pattern: '/(func)/g', replacement: '$1' }
        ],
        importStartRegex: '/^import/g',
        wildcardRules: [
          { pattern: '/from/', action: 'replace', replacement: 'to', sanitizeGroupIndex: 1 }
        ],
        wildcardFallbackAction: 'remove'
      }
    });
    const pack = LanguagePackLoader.loadFromString(json);
    expect(pack.squeezer?.bodyPlaceholder).toBe('{ /* body */ }');
    expect(pack.squeezer?.bodyPatterns).toBeDefined();
    expect(pack.squeezer?.bodyPatterns?.[0].pattern).toBeInstanceOf(RegExp);
    expect(pack.squeezer?.bodyPatterns?.[0].pattern.source).toBe('(func)');
    expect(pack.squeezer?.importStartRegex).toBeInstanceOf(RegExp);
    expect(pack.squeezer?.importStartRegex?.source).toBe('^import');
    expect(pack.squeezer?.wildcardRules?.[0].pattern).toBeInstanceOf(RegExp);
    expect(pack.squeezer?.wildcardRules?.[0].pattern.source).toBe('from');
    expect(pack.squeezer?.wildcardRules?.[0].action).toBe('replace');
    expect(pack.squeezer?.wildcardRules?.[0].replacement).toBe('to');
    expect(pack.squeezer?.wildcardRules?.[0].sanitizeGroupIndex).toBe(1);
    expect(pack.squeezer?.wildcardFallbackAction).toBe('remove');
  });

  it('throws Zod error on malformed/invalid configuration', () => {
    const invalidJson = JSON.stringify({
      metadata: {
        name: 'typescript',
        // missing version and fileExtensions
      },
      parserName: '' // should be min(1)
    });

    expect(() => LanguagePackLoader.loadFromString(invalidJson)).toThrow();
  });

  it('throws SyntaxError on syntactically invalid/malformed JSON string', () => {
    expect(() => LanguagePackLoader.loadFromString('{ malformed json }')).toThrow(SyntaxError);
  });

  it('handles invalid input types and schemas gracefully in loadFromString', () => {
    expect(() => LanguagePackLoader.loadFromString(null as any)).toThrow('expected JSON string');
    expect(() => LanguagePackLoader.loadFromString('   ')).toThrow('JSON string is empty');
    expect(() => LanguagePackLoader.loadFromString('{}')).toThrow('Schema validation failed');
  });

  it('safely parses regex flags and patterns in parseRegexString', () => {
    // ES2024 flag 'v'
    const reV = parseRegexString('/foo/v');
    expect(reV.flags).toBe('v');
    expect(reV.source).toBe('foo');

    // Deduplication of flags
    const reDedup = parseRegexString('/foo/vvggii');
    expect(reDedup.flags).toContain('g');
    expect(reDedup.flags).toContain('i');
    expect(reDedup.flags).toContain('v');
    expect(reDedup.flags.length).toBe(3);

    // Raw pattern fallback with flags deduplication
    const reRaw = parseRegexString('foo', 'ggi');
    expect(reRaw.flags).toBe('gi');
    expect(reRaw.source).toBe('foo');

    // Safe error handling for invalid pattern syntax
    expect(() => parseRegexString('/(/')).toThrow('Invalid regular expression');
    expect(() => parseRegexString('(')).toThrow('Invalid regular expression');
  });

  it('loads a single pack from file or multiple packs from a directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-loader-test-'));
    
    const pack1Content = JSON.stringify({
      metadata: { name: 'python', version: '1.0.0', fileExtensions: ['.py'] },
      parserName: 'tree-sitter-python',
      regexPatterns: { commentDetection: '#.*' }
    });

    const pack2Content = JSON.stringify({
      metadata: { name: 'go', version: '1.0.0', fileExtensions: ['.go'] },
      parserName: 'tree-sitter-go',
      regexPatterns: { commentDetection: '//.*' }
    });

    const malformedContent = '{ invalid json }';

    const pack1Path = path.join(tempDir, 'python.json');
    const pack2Path = path.join(tempDir, 'go.json');
    const malformedPath = path.join(tempDir, 'malformed.json');

    fs.writeFileSync(pack1Path, pack1Content);
    fs.writeFileSync(pack2Path, pack2Content);
    fs.writeFileSync(malformedPath, malformedContent);

    const registry = new LanguagePackRegistry();

    // 1. Test loadFromFile on valid file
    const loadedPack1 = LanguagePackLoader.loadFromFile(pack1Path);
    expect(loadedPack1.metadata.name).toBe('python');

    // 2. Test loadFromFile on malformed file
    expect(() => LanguagePackLoader.loadFromFile(malformedPath)).toThrow();

    // 3. Test loadFromDirectory (should load python and go, and print/log warning for malformed)
    LanguagePackLoader.loadFromDirectory(tempDir, registry);
    expect(registry.lookup('.py')?.metadata.name).toBe('python');
    expect(registry.lookup('.go')?.metadata.name).toBe('go');

    // 4. Test loadLanguagePacks on file
    const registry2 = new LanguagePackRegistry();
    loadLanguagePacks(registry2, pack1Path);
    expect(registry2.lookup('.py')?.metadata.name).toBe('python');

    // 5. Test loadLanguagePacks on directory
    const registry3 = new LanguagePackRegistry();
    loadLanguagePacks(registry3, tempDir);
    expect(registry3.lookup('.py')?.metadata.name).toBe('python');
    expect(registry3.lookup('.go')?.metadata.name).toBe('go');

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles non-existent directory in loadFromDirectory gracefully', () => {
    const registry = new LanguagePackRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    LanguagePackLoader.loadFromDirectory('/non-existent-directory-xyz', registry);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[LanguagePackLoader] Directory does not exist')
    );
    warnSpy.mockRestore();
  });

  it('handles missing configPath in loadLanguagePacks gracefully', () => {
    const registry = new LanguagePackRegistry();
    loadLanguagePacks(registry, undefined);
    expect(registry.getAll()).toHaveLength(0);
  });

  it('handles processing error in loadLanguagePacks gracefully', () => {
    const registry = new LanguagePackRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadLanguagePacks(registry, '/non-existent-path-abc');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[LanguagePackLoader] Warning: Failed to process configPath')
    );
    warnSpy.mockRestore();
  });
});



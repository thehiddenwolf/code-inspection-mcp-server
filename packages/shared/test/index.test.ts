import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  beforeEach(() => {
    LanguagePackRegistry.setInstance(new LanguagePackRegistry());
  });
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
        fileExtensions: ['.ts', 'tsx', 'JS'],
      },
      supportedLanguages: ['.ts', 'tsx', 'JS'],
      fileExtensions: ['.ts', 'tsx', 'JS'],
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

  it('handles registering a pack with no supported languages', () => {
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
        fileExtensions: ['.ts', '.tsx'],
      },
      supportedLanguages: ['.ts', '.tsx'],
      fileExtensions: ['.ts', '.tsx'],
      parserName: 'parser1'
    };
    const mockPack2: LanguagePack = {
      metadata: {
        name: 'pack2',
        version: '1.0.0',
        fileExtensions: ['.py'],
      },
      supportedLanguages: ['.py'],
      fileExtensions: ['.py'],
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
      supportedLanguages: ['.ts'],
      fileExtensions: ['.ts'],
      parserName: 'parser1'
    };
    const pack2: LanguagePack = {
      metadata: { name: 'ts2', version: '1.0.0', fileExtensions: ['.ts'] },
      supportedLanguages: ['.ts'],
      fileExtensions: ['.ts'],
      parserName: 'parser2'
    };

    registry.register(pack1);
    expect(registry.lookup('.ts')).toBe(pack1);

    registry.register(pack2);
    expect(registry.lookup('.ts')).toBe(pack2);
  });
});

describe('LanguagePackLoader', () => {
  beforeEach(() => {
    LanguagePackRegistry.setInstance(new LanguagePackRegistry());
  });

  it('loads valid language pack from module file and validates regexes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-loader-test-'));
    const packPath = path.join(tempDir, 'typescript-pack.js');
    const packContent = `
      export default {
        metadata: {
          name: 'typescript',
          version: '1.0.0',
          fileExtensions: ['.ts', '.tsx']
        },
        supportedLanguages: ['.ts', '.tsx'],
        parserName: 'tree-sitter-typescript',
        regexPatterns: {
          commentDetection: /\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/+/g,
          importExtraction: /^import\\s+/gm,
          exportExtraction: /^export\\s+/gm
        }
      };
    `;
    fs.writeFileSync(packPath, packContent, 'utf8');

    try {
      const packResult = await LanguagePackLoader.loadFromFile(packPath);
      const pack = Array.isArray(packResult) ? packResult[0] : packResult;
      expect(pack.metadata.name).toBe('typescript');
      expect(pack.parserName).toBe('tree-sitter-typescript');
      expect(pack.regexPatterns?.commentDetection).toBeInstanceOf(RegExp);
      expect(pack.regexPatterns?.commentDetection.source).toBe('\\/\\/.*|\\/\\*[\\s\\S]*?\\*\\/+');
      expect(pack.regexPatterns?.importExtraction).toBeInstanceOf(RegExp);
      expect(pack.regexPatterns?.importExtraction.source).toBe('^import\\s+');
      expect(pack.regexPatterns?.importExtraction.flags).toBe('gm');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads rules correctly from module file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-loader-test-'));
    const packPath = path.join(tempDir, 'rules-pack.js');
    const packContent = `
      export default {
        metadata: { name: 'test', version: '1.0.0', fileExtensions: ['.test'] },
        supportedLanguages: ['.test'],
        parserName: 'test-parser',
        rules: {
          comment: { action: 'document', maxLines: 5 },
          import: { action: 'shrink', unusedOnly: true }
        }
      };
    `;
    fs.writeFileSync(packPath, packContent, 'utf8');

    try {
      const packResult = await LanguagePackLoader.loadFromFile(packPath);
      const pack = Array.isArray(packResult) ? packResult[0] : packResult;
      expect(pack.rules?.comment?.action).toBe('document');
      expect(pack.rules?.comment?.maxLines).toBe(5);
      expect(pack.rules?.import?.action).toBe('shrink');
      expect(pack.rules?.import?.unusedOnly).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loads squeezer rules correctly from module file', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-loader-test-'));
    const packPath = path.join(tempDir, 'squeezer-pack.js');
    const packContent = `
      export default {
        metadata: { name: 'test', version: '1.0.0', fileExtensions: ['.test'] },
        supportedLanguages: ['.test'],
        parserName: 'test-parser',
        squeezer: {
          bodyPlaceholder: '{ /* body */ }',
          bodyPatterns: [
            { pattern: /(func)/g, replacement: '$1' }
          ],
          importStartRegex: /^import/g,
          wildcardRules: [
            { pattern: /from/, action: 'replace', replacement: 'to', sanitizeGroupIndex: 1 }
          ],
          wildcardFallbackAction: 'remove'
        }
      };
    `;
    fs.writeFileSync(packPath, packContent, 'utf8');

    try {
      const packResult = await LanguagePackLoader.loadFromFile(packPath);
      const pack = Array.isArray(packResult) ? packResult[0] : packResult;
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
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('throws Zod error on malformed/invalid configuration', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-loader-test-'));
    const packPath = path.join(tempDir, 'invalid-pack.js');
    const packContent = `
      export default {
        metadata: {
          name: 'typescript',
          // missing version and fileExtensions
        },
        parserName: '' // should be min(1)
      };
    `;
    fs.writeFileSync(packPath, packContent, 'utf8');

    try {
      await expect(LanguagePackLoader.loadFromFile(packPath)).rejects.toThrow();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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

  it('loads a single pack from file or multiple packs from a directory', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-loader-test-'));
    
    const pack1Content = `
      export default {
        metadata: { name: 'python', version: '1.0.0', fileExtensions: ['.py'] },
        supportedLanguages: ['.py'],
        parserName: 'tree-sitter-python',
        regexPatterns: { commentDetection: /#.*/ }
      };
    `;

    const pack2Content = `
      export default {
        metadata: { name: 'go', version: '1.0.0', fileExtensions: ['.go'] },
        supportedLanguages: ['.go'],
        parserName: 'tree-sitter-go',
        regexPatterns: { commentDetection: /\\/\\/.*/ }
      };
    `;

    const malformedContent = `
      export default {
        metadata: { name: 'malformed' }
      };
    `;

    const pack1Path = path.join(tempDir, 'python.js');
    const pack2Path = path.join(tempDir, 'go.js');
    const malformedPath = path.join(tempDir, 'malformed.js');

    fs.writeFileSync(pack1Path, pack1Content);
    fs.writeFileSync(pack2Path, pack2Content);
    fs.writeFileSync(malformedPath, malformedContent);

    const registry = new LanguagePackRegistry();

    // 1. Test loadFromFile on valid file
    const loadedPackResult1 = await LanguagePackLoader.loadFromFile(pack1Path);
    const loadedPack1 = Array.isArray(loadedPackResult1) ? loadedPackResult1[0] : loadedPackResult1;
    expect(loadedPack1.metadata.name).toBe('python');

    // 2. Test loadFromFile on malformed file
    await expect(LanguagePackLoader.loadFromFile(malformedPath)).rejects.toThrow();

    // 3. Test loadFromDirectory (should load python and go, and print/log warning for malformed)
    await LanguagePackLoader.loadFromDirectory(tempDir, registry);
    expect(registry.lookup('.py')?.metadata.name).toBe('python');
    expect(registry.lookup('.go')?.metadata.name).toBe('go');

    // 4. Test loadLanguagePacks on file
    const registry2 = new LanguagePackRegistry();
    await loadLanguagePacks(registry2, pack1Path);
    expect(registry2.lookup('.py')?.metadata.name).toBe('python');

    // 5. Test loadLanguagePacks on directory
    const registry3 = new LanguagePackRegistry();
    await loadLanguagePacks(registry3, tempDir);
    expect(registry3.lookup('.py')?.metadata.name).toBe('python');
    expect(registry3.lookup('.go')?.metadata.name).toBe('go');

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles non-existent directory in loadFromDirectory gracefully', async () => {
    const registry = new LanguagePackRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await LanguagePackLoader.loadFromDirectory('/non-existent-directory-xyz', registry);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[LanguagePackLoader] Directory does not exist')
    );
    warnSpy.mockRestore();
  });

  it('handles missing configPath in loadLanguagePacks gracefully', async () => {
    const registry = new LanguagePackRegistry();
    await loadLanguagePacks(registry, undefined);
    expect(registry.getAll()).toHaveLength(0);
  });

  it('handles processing error in loadLanguagePacks gracefully', async () => {
    const registry = new LanguagePackRegistry();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await loadLanguagePacks(registry, '/non-existent-path-abc');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[LanguagePackLoader] Warning: Failed to process configPath')
    );
    warnSpy.mockRestore();
  });
});

import { findServerConfigPath, loadConfigAndPacks, parseLanguagePackRef } from '../src/index.js';

describe('ServerConfig & ConfigLoader', () => {
  it('findServerConfigPath resolves existing files', () => {
    const tempConfig = path.join(os.tmpdir(), `hermes-config-${Date.now()}.json`);
    fs.writeFileSync(tempConfig, JSON.stringify({ languagePacks: [] }), 'utf8');

    try {
      const found = findServerConfigPath(tempConfig);
      expect(found).toBe(tempConfig);
    } finally {
      fs.unlinkSync(tempConfig);
    }
  });

  it('parseLanguagePackRef identifies types correctly', () => {
    const configDir = '/etc/hermes';
    const refGit1 = parseLanguagePackRef('git+https://github.com/hermes/pack.git#main', configDir);
    expect(refGit1.type).toBe('git');
    expect(refGit1.gitUrl).toBe('https://github.com/hermes/pack.git');
    expect(refGit1.gitRef).toBe('main');

    const refGit2 = parseLanguagePackRef('https://github.com/hermes/pack.git', configDir);
    expect(refGit2.type).toBe('git');
    expect(refGit2.gitUrl).toBe('https://github.com/hermes/pack.git');

    const refFile = parseLanguagePackRef('./custom/my-pack.js', configDir);
    expect(refFile.type).toBe('file');
    expect(refFile.resolvedPath).toBe(path.resolve(configDir, './custom/my-pack.js'));

    const refNpm = parseLanguagePackRef('@scope/my-package', configDir);
    expect(refNpm.type).toBe('npm');
    expect(refNpm.packageName).toBe('@scope/my-package');
  });

  it('loadConfigAndPacks loads and registers local files', async () => {
    const tempDir = path.join(os.tmpdir(), `hermes-config-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const packPath = path.join(tempDir, 'custom-pack.js');
    const configPath = path.join(tempDir, 'hermes-config.json');

    const customPack = {
      metadata: {
        name: 'custom',
        version: '1.0.0',
        fileExtensions: ['.custom'],
      },
      supportedLanguages: ['.custom'],
      parserName: 'tree-sitter-custom',
      lintFix: {
        commands: [['custom-fixer', '--write']],
      },
      patternMiner: {
        patterns: [
          {
            id: 'custom-pattern-1',
            name: 'Custom Pattern',
            description: 'A custom pattern',
            category: 'style',
            severity: 'warning',
            languages: ['custom'],
            pattern: 'TODO',
            message_template: 'Avoid TODOs',
          },
        ],
      },
    };

    const serverConfig = {
      languagePacks: [
        './custom-pack.js',
      ],
    };

    fs.writeFileSync(packPath, 'export default ' + JSON.stringify(customPack) + ';', 'utf8');
    fs.writeFileSync(configPath, JSON.stringify(serverConfig), 'utf8');

    const registry = new LanguagePackRegistry();

    try {
      await loadConfigAndPacks(registry, configPath);
      const pack = registry.lookup('.custom');
      expect(pack).toBeDefined();
      expect(pack?.metadata.name).toBe('custom');
      expect(pack?.lintFix?.commands).toEqual([['custom-fixer', '--write']]);
      expect(pack?.patternMiner?.patterns?.[0].id).toBe('custom-pattern-1');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loadConfigAndPacks loads and registers packs from environment variables', async () => {
    const tempDir = path.join(os.tmpdir(), `hermes-env-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const packPath = path.join(tempDir, 'env-pack.js');
    const envPack = {
      metadata: {
        name: 'envlang',
        version: '1.0.0',
        fileExtensions: ['.envlang'],
      },
      supportedLanguages: ['.envlang'],
      parserName: 'tree-sitter-envlang',
    };

    fs.writeFileSync(packPath, 'export default ' + JSON.stringify(envPack) + ';', 'utf8');

    const originalHermesConfig = process.env.HERMES_CONFIG;
    const originalHermesPacks = process.env.HERMES_LANGUAGE_PACKS;

    const registry = new LanguagePackRegistry();

    try {
      // 1. Test raw JSON env config
      process.env.HERMES_CONFIG = JSON.stringify({
        languagePacks: [packPath],
      });
      await loadConfigAndPacks(registry);
      expect(registry.lookup('.envlang')).toBeDefined();
      expect(registry.lookup('.envlang')?.metadata.name).toBe('envlang');

      // 2. Test direct list env config
      const registry2 = new LanguagePackRegistry();
      delete process.env.HERMES_CONFIG;
      process.env.HERMES_LANGUAGE_PACKS = packPath;
      await loadConfigAndPacks(registry2);
      expect(registry2.lookup('.envlang')).toBeDefined();
      expect(registry2.lookup('.envlang')?.metadata.name).toBe('envlang');
    } finally {
      if (originalHermesConfig === undefined) {
        delete process.env.HERMES_CONFIG;
      } else {
        process.env.HERMES_CONFIG = originalHermesConfig;
      }
      if (originalHermesPacks === undefined) {
        delete process.env.HERMES_LANGUAGE_PACKS;
      } else {
        process.env.HERMES_LANGUAGE_PACKS = originalHermesPacks;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loadConfigAndPacks loads and registers direct array JSON format config', async () => {
    const tempDir = path.join(os.tmpdir(), `hermes-array-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const packPath = path.join(tempDir, 'array-pack.js');
    const configPath = path.join(tempDir, 'hermes-config.json');

    const arrayPack = {
      metadata: {
        name: 'arraylang',
        version: '1.0.0',
        fileExtensions: ['.arraylang'],
      },
      supportedLanguages: ['.arraylang'],
      parserName: 'tree-sitter-arraylang',
    };

    const serverConfig = [
      './array-pack.js',
    ];

    fs.writeFileSync(packPath, 'export default ' + JSON.stringify(arrayPack) + ';', 'utf8');
    fs.writeFileSync(configPath, JSON.stringify(serverConfig), 'utf8');

    const registry = new LanguagePackRegistry();

    try {
      await loadConfigAndPacks(registry, configPath);
      expect(registry.lookup('.arraylang')).toBeDefined();
      expect(registry.lookup('.arraylang')?.metadata.name).toBe('arraylang');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('findServerConfigPath searches ~/.code-inspection-mcp.json first', () => {
    const homeConfig = path.join(os.homedir(), '.code-inspection-mcp.json');
    const alreadyExists = fs.existsSync(homeConfig);
    if (!alreadyExists) {
      fs.writeFileSync(homeConfig, '[]', 'utf8');
    }

    try {
      const found = findServerConfigPath();
      expect(found).toBe(homeConfig);
    } finally {
      if (!alreadyExists) {
        fs.unlinkSync(homeConfig);
      }
    }
  });
});

import rpgPack from '../src/packs/rpg.js';

describe('RPG Language Pack', () => {
  it('is registered in default packs', () => {
    const registry = LanguagePackRegistry.getInstance();
    if (!registry.lookup('.rpgle')) {
      registry.register(rpgPack);
    }
    expect(registry.lookup('.rpgle')).toBe(rpgPack);
    expect(registry.lookup('.sqlrpgle')).toBe(rpgPack);
    expect(registry.lookup('.rpg')).toBe(rpgPack);
    expect(registry.lookup('rpg')).toBe(rpgPack);
  });

  it('correctly matches RPG comments', () => {
    const commentDetect = rpgPack.regexPatterns?.commentDetection;
    expect(commentDetect).toBeDefined();
    if (!commentDetect) return;

    // Fixed-form comment (asterisk in column 7)
    const fixedComment = '      * This is a fixed form comment';
    expect(fixedComment.match(commentDetect)).toBeTruthy();

    // Free-form comment
    const freeComment = '    // This is a free form comment';
    expect(freeComment.match(commentDetect)).toBeTruthy();

    // Normal line (not a comment)
    const normalLine = '     C     MYVAL         IFEQ      \'1\'';
    const matchNormal = normalLine.match(commentDetect);
    expect(matchNormal).toBeNull();
  });

  it('extracts imports correctly', () => {
    const code = `
      /copy qsysinc/qrpglesrc,uuid
      /include QCPYSRC,MEMBER
    `;
    const imports = rpgPack.repograph?.extractImports(code, 'test.rpgle');
    expect(imports).toBeDefined();
    expect(imports).toHaveLength(2);
    expect(imports?.[0].source).toBe('qsysinc/qrpglesrc,uuid');
    expect(imports?.[1].source).toBe('QCPYSRC,MEMBER');
  });

  it('extracts declarations correctly', () => {
    const code = `
     P MyProc            B
     D MyVar           S             10A
      dcl-proc FreeProc;
      dcl-s sVar varchar(50);
      dcl-ds dsVar;
    `;
    const declarations = rpgPack.repograph?.extractDeclarations(code, 'test.rpgle');
    expect(declarations).toBeDefined();
    expect(declarations).toHaveLength(5);
    expect(declarations?.map(d => d.name)).toEqual([
      'FreeProc',
      'MyProc',
      'sVar',
      'dsVar',
      'MyVar',
    ]);
  });

  it('extracts relationships correctly', () => {
    const code = `
      dcl-proc FreeProc;
        callp AnotherProc();
        exsr MySubroutine;
      end-proc;
    `;
    const relationships = rpgPack.repograph?.extractRelationships(code, 'test.rpgle');
    expect(relationships).toBeDefined();
    expect(relationships).toHaveLength(2);
    expect(relationships?.[0]).toEqual({
      from: 'sym:FreeProc@test.rpgle',
      to: 'sym:AnotherProc',
      type: 'calls',
    });
    expect(relationships?.[1]).toEqual({
      from: 'sym:FreeProc@test.rpgle',
      to: 'sym:MySubroutine',
      type: 'calls',
    });
  });

  it('squeezes procedure bodies correctly', () => {
    const freeCode = 'dcl-proc FreeProc;\n  stmt1;\n  stmt2;\nend-proc;';
    const fixedCode = '     P MyProc            B\n  stmt1;\n  stmt2;\n     P                   E';

    let squeezedFree = freeCode;
    for (const pat of rpgPack.squeezer?.bodyPatterns || []) {
      squeezedFree = squeezedFree.replace(pat.pattern, pat.replacement);
    }
    expect(squeezedFree).toContain('dcl-proc FreeProc;\n    ...\nend-proc;');

    let squeezedFixed = fixedCode;
    for (const pat of rpgPack.squeezer?.bodyPatterns || []) {
      squeezedFixed = squeezedFixed.replace(pat.pattern, pat.replacement);
    }
    expect(squeezedFixed).toContain('     P MyProc            B\n    ...\nP                   E');
  });

  it('defines solidEnforcer rules and lintFix commands', () => {
    expect(rpgPack.solidEnforcer).toBeDefined();
    expect(rpgPack.solidEnforcer?.classRegex).toBeDefined();
    expect(rpgPack.solidEnforcer?.interfaceRegex).toBeDefined();
    expect(rpgPack.solidEnforcer?.newInstantiationRegex).toBeDefined();

    expect(rpgPack.lintFix).toBeDefined();
    expect(rpgPack.lintFix?.commands).toContainEqual(['rpgle-format', '--write']);
    expect(rpgPack.lintFix?.commands).toContainEqual(['rpgle-lint', '--fix']);
  });
});

import cobolPack from '../src/packs/cobol.js';
import bashPack from '../src/packs/bash.js';
import powershellPack from '../src/packs/powershell.js';

describe('COBOL Language Pack', () => {
  it('is registered in default packs', () => {
    const registry = LanguagePackRegistry.getInstance();
    if (!registry.lookup('.cbl')) {
      registry.register(cobolPack);
    }
    expect(registry.lookup('.cbl')).toBe(cobolPack);
    expect(registry.lookup('.cob')).toBe(cobolPack);
  });

  it('correctly matches COBOL comments', () => {
    const commentDetect = cobolPack.regexPatterns?.commentDetection;
    expect(commentDetect).toBeDefined();
    if (!commentDetect) return;

    const fixedComment = '      * THIS IS A COMMENT';
    expect(fixedComment.match(commentDetect)).toBeTruthy();

    const freeComment = '      *> THIS IS A FREE COMMENT';
    expect(freeComment.match(commentDetect)).toBeTruthy();
  });

  it('extracts declarations and imports', () => {
    const code = `
       PROGRAM-ID. HELLO-WORLD.
       PROCEDURE DIVISION.
       100-INITIALIZE.
           COPY "MYCOPY".
    `;
    const declarations = cobolPack.repograph?.extractDeclarations(code, 'test.cbl');
    expect(declarations).toBeDefined();
    expect(declarations).toHaveLength(2);
    expect(declarations?.map(d => d.name)).toEqual(['HELLO-WORLD', '100-INITIALIZE']);

    const imports = cobolPack.repograph?.extractImports(code, 'test.cbl');
    expect(imports).toBeDefined();
    expect(imports).toHaveLength(1);
    expect(imports?.[0].source).toBe('MYCOPY');
  });
});

describe('Bash Language Pack', () => {
  it('is registered in default packs', () => {
    const registry = LanguagePackRegistry.getInstance();
    if (!registry.lookup('.sh')) {
      registry.register(bashPack);
    }
    expect(registry.lookup('.sh')).toBe(bashPack);
  });

  it('correctly matches Bash comments and ignores shebangs', () => {
    const commentDetect = bashPack.regexPatterns?.commentDetection;
    expect(commentDetect).toBeDefined();
    if (!commentDetect) return;

    const comment = '# This is a comment';
    expect(comment.match(commentDetect)).toBeTruthy();

    const shebang = '#!/bin/bash';
    expect(shebang.match(commentDetect)).toBeNull();
  });

  it('extracts declarations and squeezes function bodies', () => {
    const code = `
      function my_func() {
        echo "hello"
      }
    `;
    const declarations = bashPack.repograph?.extractDeclarations(code, 'test.sh');
    expect(declarations).toBeDefined();
    expect(declarations).toHaveLength(1);
    expect(declarations?.[0].name).toBe('my_func');

    let squeezed = code;
    for (const pat of bashPack.squeezer?.bodyPatterns || []) {
      squeezed = squeezed.replace(pat.pattern, pat.replacement);
    }
    expect(squeezed).toContain('function my_func() {\n    ...\n}');
  });
});

describe('PowerShell Language Pack', () => {
  it('is registered in default packs', () => {
    const registry = LanguagePackRegistry.getInstance();
    if (!registry.lookup('.ps1')) {
      registry.register(powershellPack);
    }
    expect(registry.lookup('.ps1')).toBe(powershellPack);
  });

  it('extracts declarations and relationships', () => {
    const code = `
      function Get-Power {
        param($val)
        class MyClass {}
        Import-Module MyModule
        Write-Host "Test"
      }
    `;
    const declarations = powershellPack.repograph?.extractDeclarations(code, 'test.ps1');
    expect(declarations).toBeDefined();
    expect(declarations).toHaveLength(1);
    expect(declarations?.[0].name).toBe('Get-Power');

    const imports = powershellPack.repograph?.extractImports(code, 'test.ps1');
    expect(imports).toBeDefined();
    expect(imports).toHaveLength(1);
    expect(imports?.[0].source).toBe('MyModule');
  });
});




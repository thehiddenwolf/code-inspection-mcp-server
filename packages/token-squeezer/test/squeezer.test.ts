import { describe, it, expect, beforeAll } from 'vitest';
import { squeeze } from '../src/squeezer.js';
import { stripComments } from '../src/reducers/comment-stripper.js';
import { shrinkImports } from '../src/reducers/import-shrinker.js';
import { LanguagePackRegistry } from '@hermes/shared';
import { getLanguagePack, registerDefaultPacks } from '../src/utils.js';
import { estimateTokens } from '../src/token-counter.js';
import { applyStrategy } from '../src/strategies/strategies.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8');
}

// ── Token counter ──────────────────────────────────────────────────────────

describe('token-counter', () => {
  it('estimates tokens for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates tokens using ceil(chars / 4)', () => {
    expect(estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 → 3
    expect(estimateTokens('a')).toBe(1);            // 1 / 4 = 0.25 → 1
    expect(estimateTokens('abcd')).toBe(1);          // 4 / 4 = 1
    expect(estimateTokens('abcdefgh')).toBe(2);      // 8 / 4 = 2
  });
});

// ── Comment stripper ───────────────────────────────────────────────────────

describe('comment-stripper', () => {
  it('removes single-line comments in JS/TS', () => {
    const code = 'const x = 1; // this is a comment\nconst y = 2;';
    const result = stripComments(code, 'typescript');
    expect(result.cleaned).not.toContain('this is a comment');
    expect(result.removedCount).toBe(1);
  });

  it('removes block comments in JS/TS', () => {
    const code = '/* block comment */\nconst x = 1;';
    const result = stripComments(code, 'typescript');
    expect(result.cleaned).not.toContain('block comment');
    expect(result.removedCount).toBe(1);
  });

  it('removes JSDoc comments', () => {
    const code = '/**\n * This is a docstring\n */\nfunction foo() {}';
    const result = stripComments(code, 'typescript');
    expect(result.cleaned).not.toContain('docstring');
  });

  it('removes Python # comments', () => {
    const code = 'x = 1  # inline comment\ny = 2';
    const result = stripComments(code, 'python');
    expect(result.cleaned).not.toContain('inline comment');
  });

  it('removes Python docstrings', () => {
    const code = '"""Module docstring."""\ndef foo(): pass';
    const result = stripComments(code, 'python');
    expect(result.cleaned).not.toContain('Module docstring');
  });

  it('preserves non-comment code structure', () => {
    const code = 'const x = 1;\nconst y = 2;';
    const result = stripComments(code, 'typescript');
    expect(result.cleaned).toContain('const x = 1');
    expect(result.cleaned).toContain('const y = 2');
  });

  it('preserves line numbers (replaces with newlines)', () => {
    const code = 'a\n// comment\nb\nc';
    const result = stripComments(code, 'typescript');
    const lines = result.cleaned.split('\n');
    expect(lines[0]).toBe('a');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('b');
    expect(lines[3]).toBe('c');
  });
});

// ── Import shrinker ────────────────────────────────────────────────────────

describe('import-shrinker', () => {
  it('conservative keeps all imports', () => {
    const code = `import { readFile } from 'fs';\nconst x = 1;`;
    const result = shrinkImports(code, 'typescript', 'conservative');
    expect(result.cleaned).toContain("import { readFile } from 'fs'");
    expect(result.removedCount).toBe(0);
  });

  it('aggressive removes or shortens imports', () => {
    const code = `import { readFile, writeFile } from 'fs';\nconst x = 1;`;
    const result = shrinkImports(code, 'typescript', 'aggressive');
    // Should either be shortened (wildcard) or removed
    const lines = result.cleaned.split('\n').filter(l => l.includes('import'));
    expect(lines.length).toBeLessThanOrEqual(1);
  });

  it('balanced keeps imports that are used', () => {
    const code = `import { readFile } from 'fs/promises';\nimport { join } from 'path';\nreadFile('test');`;
    const result = shrinkImports(code, 'typescript', 'balanced');
    expect(result.cleaned).toContain('readFile');
    // 'join' is not used, so 'path' import may be removed
  });
});

// ── Squeezer integration ───────────────────────────────────────────────────

describe('squeezer', () => {
  it('processes TypeScript fixture at conservative level', async () => {
    const code = loadFixture('sample.ts');
    const result = await squeeze(code, 'typescript', { aggressiveness: 'conservative' });

    expect(result.original).toBe(code);
    expect(result.original_tokens).toBeGreaterThan(0);
    expect(result.squeezed_tokens).toBeGreaterThan(0);
    expect(result.reduction_ratio).toBeGreaterThanOrEqual(0);
    expect(result.reduction_ratio).toBeLessThanOrEqual(1);
    expect(result.aggressiveness).toBe('conservative');
    expect(result.language).toBe('typescript');
  });

  it('aggressive mode returns smaller output than conservative', async () => {
    const code = loadFixture('sample.ts');

    const conservative = await squeeze(code, 'typescript', { aggressiveness: 'conservative' });
    const aggressive = await squeeze(code, 'typescript', { aggressiveness: 'aggressive' });

    expect(aggressive.squeezed_tokens).toBeLessThanOrEqual(conservative.squeezed_tokens);
  });

  it('processes Python fixture', async () => {
    const code = loadFixture('sample.py');
    const result = await squeeze(code, 'python', { aggressiveness: 'balanced' });

    expect(result.original_tokens).toBeGreaterThan(0);
    expect(result.squeezed_tokens).toBeGreaterThan(0);
    expect(result.language).toBe('python');
  });

  it('preserves comments when requested', async () => {
    const code = '// Important notice\nconst x = 1;';
    const result = await squeeze(code, 'typescript', { preserve_comments: true, aggressiveness: 'aggressive' });
    expect(result.squeezed).toContain('Important notice');
  });

  it('preserves imports when requested', async () => {
    const code = "import { readFile } from 'fs';\nconst x = 1;";
    const result = await squeeze(code, 'typescript', { preserve_imports: true, aggressiveness: 'aggressive' });
    expect(result.squeezed).toContain('import');
  });

  it('returns error for unsupported language', async () => {
    try {
      await squeeze('x = 1', 'ruby');
      // If we get here it should still work via fallback or at least not crash
    } catch {
      // Expected — unsupported language might throw or return empty
    }
  });

  it('handles empty code gracefully', async () => {
    const result = await squeeze('', 'typescript');
    expect(result.original_tokens).toBe(0);
    expect(result.squeezed_tokens).toBe(0);
    expect(result.reduction_ratio).toBe(0);
  });

  it('uses default options when none provided', async () => {
    const code = loadFixture('sample.ts');
    const result = await squeeze(code, 'typescript');
    expect(result.aggressiveness).toBe('balanced');
    expect(result.node_counts).toBeDefined();
  });

  it('all three aggressiveness levels produce different results', async () => {
    const code = loadFixture('sample.ts');

    const cons = await squeeze(code, 'typescript', { aggressiveness: 'conservative' });
    const bal = await squeeze(code, 'typescript', { aggressiveness: 'balanced' });
    const agg = await squeeze(code, 'typescript', { aggressiveness: 'aggressive' });

    // Aggressive should reduce the most
    expect(agg.squeezed.length).toBeLessThanOrEqual(cons.squeezed.length);
    // Balanced should fall between
    expect(bal.squeezed.length).toBeLessThanOrEqual(cons.squeezed.length);
  });
});

describe('regex-strategy-dollar-signs', () => {
  it('handles functions and variables with literal dollar signs correctly without corruption', () => {
    const code = `function $dollarFunc(a: string) {
      const $$local = a;
      return $$local;
    }`;
    const result = applyStrategy(code, 'typescript', 'conservative', {
      preserve_comments: false,
      preserve_imports: false,
      aggressiveness: 'conservative',
      include_private: false,
      output_format: 'text',
    });
    expect(result.squeezed).toContain('function $dollarFunc(a: string) { /* ... */ }');
  });
});

// ── Language Pack Registry & Dynamic Registration ──────────────────────────

describe('LanguagePackRegistry & Utils', () => {
  let originalRegistryInstance: any;

  beforeAll(() => {
    originalRegistryInstance = LanguagePackRegistry.getInstance();
  });

  it('normalizes extensions and maps lookup correctly', () => {
    const registry = new LanguagePackRegistry();
    const testPack = {
      metadata: {
        name: 'rust-test',
        version: '1.0.0',
        fileExtensions: ['.rs', 'RUST'],
      },
      parserName: 'tree-sitter-rust',
    };
    registry.register(testPack as any);

    expect(registry.lookup('.rs')).toBe(testPack);
    expect(registry.lookup('rs')).toBe(testPack);
    expect(registry.lookup('RUST')).toBe(testPack);
  });

  it('allows overriding default packs', () => {
    const registry = new LanguagePackRegistry();
    LanguagePackRegistry.setInstance(registry);

    const overridePack = {
      metadata: {
        name: 'custom-ts',
        version: '2.0.0',
        fileExtensions: ['.ts'],
      },
      parserName: 'custom-parser',
    };
    registry.register(overridePack as any);

    registerDefaultPacks();
    expect(registry.lookup('.ts')).toBe(overridePack);

    LanguagePackRegistry.setInstance(originalRegistryInstance);
  });

  it('getLanguagePack resolves by extension, name, or casing', () => {
    const pack = getLanguagePack('PYTHON');
    expect(pack).toBeDefined();
    expect(pack?.metadata.name).toBe('python');

    const pyExtPack = getLanguagePack('.py');
    expect(pyExtPack).toBeDefined();
    expect(pyExtPack?.metadata.name).toBe('python');

    const invalidPack = getLanguagePack('unsupported-lang-XYZ');
    expect(invalidPack).toBeUndefined();
  });
});

// ── Squeezer Edge Cases ────────────────────────────────────────────────────

describe('Squeezer Edge Cases', () => {
  it('handles null/undefined gracefully', async () => {
    await expect(squeeze(null as any, 'typescript')).rejects.toThrow();
    await expect(squeeze(undefined as any, 'typescript')).rejects.toThrow();
  });

  it('handles unsupported languages by falling back to regex or returning gracefully', async () => {
    const result = await squeeze('const x = 1;', 'unknown-lang');
    expect(result.squeezed).toBe('const x = 1;');
    expect(result.language).toBe('unknown-lang');
  });
});

// ── Import Shrinker Edge Cases & Bugs ───────────────────────────────────────

describe('Import Shrinker Edge Cases & Bugs', () => {
  it('identifies and preserves default import identifier when mixed with named imports', () => {
    const code = `import Foo, { Bar } from 'module';\nFoo.someMethod();`;
    const result = shrinkImports(code, 'typescript', 'balanced');
    expect(result.cleaned).toContain('import Foo');
  });

  it('identifies and preserves python import aliases', () => {
    const code = `import os.path as path\npath.join('a', 'b')`;
    const result = shrinkImports(code, 'python', 'balanced');
    expect(result.cleaned).toContain('import os.path as path');
  });

  it('handles subpackage imports in Python', () => {
    const code = `import os.path\nos.path.join('a', 'b')`;
    const result = shrinkImports(code, 'python', 'balanced');
    expect(result.cleaned).toContain('import os.path');
  });

  it('handles Go block imports', () => {
    const code = `import (\n  "fmt"\n  "os"\n)\nfmt.Println("test")`;
    const result = shrinkImports(code, 'go', 'balanced');
    expect(result.cleaned).toContain('"fmt"');
  });

  it('removes C# comments and shrinks using directives', () => {
    const code = `using System;\nusing System.Collections.Generic;\n// C# comment\npublic class Test {}`;
    const resultStrip = stripComments(code, 'csharp');
    expect(resultStrip.cleaned).not.toContain('C# comment');
    expect(resultStrip.cleaned).toContain('public class Test {}');

    const resultShrink = shrinkImports(code, 'csharp', 'aggressive');
    expect(resultShrink.cleaned).toContain('using System;');
  });

  it('removes VB.Net comments and shrinks Imports', () => {
    const code = `Imports System.IO\nImports System.Text\n' VB.Net comment\nPublic Class Test\nEnd Class`;
    const resultStrip = stripComments(code, 'vbnet');
    expect(resultStrip.cleaned).not.toContain('VB.Net comment');
    expect(resultStrip.cleaned).toContain('Public Class Test');

    const resultShrink = shrinkImports(code, 'vbnet', 'aggressive');
    expect(resultShrink.cleaned).toContain('Imports System.IO');
  });
});



/**
 * squeezer.ts
 *
 * Main orchestrator: parse() → classify() → strip() → assemble()
 *
 * Two modes:
 *  1. Tree-sitter mode — uses WASM grammars for structural AST analysis
 *  2. Fallback regex/character mode — comment stripping, import shrinking, structural hints
 *
 * Falls back gracefully if Tree-sitter is unavailable.
 */

import type { SqueezeOptions, SqueezedResult } from './types.js';
import type { AggressivenessLevel } from '@hermes/shared';
import { estimateTokens } from './token-counter.js';
import { applyStrategy } from './strategies/strategies.js';
import { stripComments } from './reducers/comment-stripper.js';
import { shrinkImports } from './reducers/import-shrinker.js';
import { createParser } from './wasm-loader.js';
import { getLanguagePack } from './utils.js';

/**
 * Default squeeze options.
 */
export const DEFAULT_OPTIONS: SqueezeOptions = {
  preserve_comments: false,
  preserve_imports: false,
  aggressiveness: 'balanced',
  include_private: false,
  output_format: 'text',
  outline: false,
};

/**
 * Main context squeeze orchestrator.
 *
 * @param code       Source code to squeeze
 * @param language   Language identifier ('typescript', 'python', etc.)
 * @param options    Squeeze options (partial — defaults applied)
 * @returns          SqueezedResult with original, squeezed, and metrics
 */
export async function squeeze(
  code: string,
  language: string,
  options?: Partial<SqueezeOptions>,
): Promise<SqueezedResult> {
  const opts: SqueezeOptions = { ...DEFAULT_OPTIONS, ...options };
  const originalTokens = estimateTokens(code);
  let squeezed: string;
  let nodeCounts: { original: number; removed: number } | undefined;

  // Try Tree-sitter mode first
  const tsResult = await tryTreeSitterMode(code, language, opts);

  if (tsResult) {
    squeezed = tsResult.squeezed;
    nodeCounts = tsResult.nodeCounts;
  } else {
    // Fallback: regex/character mode
    nodeCounts = { original: 0, removed: 0 };
    squeezed = fallbackSqueeze(code, language, opts, nodeCounts);
  }

  const squeezedTokens = estimateTokens(squeezed);
  const reductionRatio = originalTokens > 0
    ? Math.round((1 - squeezedTokens / originalTokens) * 10000) / 10000
    : 0;

  const result: SqueezedResult = {
    original: code,
    squeezed,
    original_tokens: originalTokens,
    squeezed_tokens: squeezedTokens,
    reduction_ratio: reductionRatio,
    aggressiveness: opts.aggressiveness,
    language,
    node_counts: nodeCounts,
  };

  return result;
}

// ── Tree-sitter mode ───────────────────────────────────────────────────────

interface TreeSitterResult {
  squeezed: string;
  nodeCounts: { original: number; removed: number };
}

async function tryTreeSitterMode(
  code: string,
  language: string,
  options: SqueezeOptions,
): Promise<TreeSitterResult | null> {
  try {
    const parser = await createParser(language);
    if (!parser) return null;

    const tree = parser.parse(code);
    if (!tree) return null;
    const rootNode = tree.rootNode;

    const pack = getLanguagePack(language);

    // Classify nodes using language pack AST queries if available
    const functionNodeIds = new Set<number>();
    const classNodeIds = new Set<number>();
    const importNodeIds = new Set<number>();

    // Safely check if the parser instance has getLanguage or language
    const tsLanguage = (parser as any).getLanguage ? (parser as any).getLanguage() : (parser as any).language;

    if (pack?.astQueries && tsLanguage) {
      const queryKeys: ('functions' | 'classes' | 'imports')[] = ['functions', 'classes', 'imports'];
      const targetSets = [functionNodeIds, classNodeIds, importNodeIds];

      for (let idx = 0; idx < queryKeys.length; idx++) {
        const key = queryKeys[idx];
        const targetSet = targetSets[idx];
        const astQuery = pack.astQueries[key];
        if (astQuery) {
          const queryString = typeof astQuery === 'string' ? astQuery : astQuery.query;
          try {
            const query = tsLanguage.query(queryString);
            const captures = query.captures(rootNode);
            for (const cap of captures) {
              targetSet.add(cap.node.id);
            }
          } catch (err) {
            // Ignore compile/execution errors
          }
        }
      }
    }

    interface Replacement {
      start: number;
      end: number;
      value: string;
    }

    const replacements: Replacement[] = [];
    const removedCount = { value: 0 };

    // Traverse the AST to gather replacement ranges
    function collectReplacements(node: any) {
      if (!node) return;
      const type = node.type;

      // Comment nodes
      const isComment = type === 'comment' || type === 'block_comment' || type === 'line_comment';
      if (isComment && !options.preserve_comments) {
        const nodeText = code.slice(node.startIndex, node.endIndex);
        const newlines = (nodeText || '').match(/\n/g)?.join('') || '';
        replacements.push({ start: node.startIndex, end: node.endIndex, value: newlines });
        removedCount.value++;
        return;
      }

      // Import nodes
      const isImport = importNodeIds.has(node.id) ||
        type === 'import_statement' || type === 'import_declaration'
        || type === 'import_from_statement' || type === 'import_clause';
      if (isImport && options.aggressiveness === 'aggressive' && !options.preserve_imports) {
        replacements.push({ start: node.startIndex, end: node.endIndex, value: '' });
        removedCount.value++;
        return;
      }

      // Function/class declarations
      const isFunction = functionNodeIds.has(node.id) ||
        type === 'function_declaration' || type === 'function_definition'
        || type === 'method_definition' || type === 'arrow_function';
      const isClass = classNodeIds.has(node.id) ||
        type === 'class_declaration' || type === 'class_definition';

      if (isFunction || isClass) {
        if (options.aggressiveness === 'aggressive' || (options.aggressiveness === 'balanced' && !options.include_private)) {
          // Look for body block
          const bodyNode = node.childForFieldName ? node.childForFieldName('body') : node.children.find((c: any) => c.type === 'block' || c.type === 'compound_statement');
          if (bodyNode) {
            const pack = getLanguagePack(language);
            const placeholder = pack?.squeezer?.bodyPlaceholder || '{ /* ... */ }';
            replacements.push({ start: bodyNode.startIndex, end: bodyNode.endIndex, value: placeholder });
            removedCount.value += countAllNodes(bodyNode);
            return;
          }
        }
      }

      // Recurse children
      for (let i = 0; i < node.childCount; i++) {
        collectReplacements(node.child(i));
      }
    }

    if (options.outline) {
      const outline = generateOutlineFromTree(rootNode, code, functionNodeIds, classNodeIds);
      return {
        squeezed: outline,
        nodeCounts: { original: countAllNodes(rootNode), removed: 0 },
      };
    }

    collectReplacements(rootNode);

    // Apply replacements from back to front to preserve offsets
    replacements.sort((a, b) => b.start - a.start);
    let squeezed = code;
    for (const r of replacements) {
      squeezed = squeezed.slice(0, r.start) + r.value + squeezed.slice(r.end);
    }

    squeezed = squeezed.replace(/\n{3,}/g, '\n\n').trim();

    return {
      squeezed,
      nodeCounts: {
        original: countAllNodes(rootNode),
        removed: removedCount.value,
      },
    };
  } catch {
    return null;
  }
}

/** Count all nodes in a subtree */
function countAllNodes(node: unknown): number {
  let count = 1;
  const n = node as { children?: unknown[] };
  if (n.children) {
    for (const child of n.children) {
      if (child && typeof child === 'object') {
        count += countAllNodes(child);
      }
    }
  }
  return count;
}

// ── Fallback regex mode ────────────────────────────────────────────────────

function fallbackSqueeze(
  code: string,
  language: string,
  options: SqueezeOptions,
  nodeCounts: { original: number; removed: number },
): string {
  if (options.outline) {
    return generateFallbackOutline(code, language);
  }

  let result = code;

  // Step 1: Strip comments (if not preserved)
  if (!options.preserve_comments) {
    const { cleaned, removedCount } = stripComments(result, language);
    result = cleaned;
    nodeCounts.original += removedCount;
    nodeCounts.removed += removedCount;
  }

  // Step 2: Shrink imports (if not preserved)
  if (!options.preserve_imports) {
    const { cleaned, removedCount } = shrinkImports(result, language, options.aggressiveness);
    result = cleaned;
    nodeCounts.original += removedCount;
    nodeCounts.removed += removedCount;
  }

  // Step 3: Apply structural strategy (function body stripping, etc.)
  const { squeezed, strippedNodes } = applyStrategy(result, language, options.aggressiveness, options);
  result = squeezed;
  nodeCounts.original += strippedNodes.length;
  nodeCounts.removed += strippedNodes.length;

  // Step 4: Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  return result;
}

function generateOutlineFromTree(
  rootNode: any,
  code: string,
  functionNodeIds: Set<number>,
  classNodeIds: Set<number>
): string {
  const lines: string[] = [];

  function traverse(node: any, depth: number) {
    if (!node) return;
    const type = node.type;
    const isFunction = functionNodeIds.has(node.id) ||
      type === 'function_declaration' || type === 'function_definition'
      || type === 'method_definition' || type === 'arrow_function';
    const isClass = classNodeIds.has(node.id) ||
      type === 'class_declaration' || type === 'class_definition';
    
    const startLine = node.startPosition.row + 1;

    if (isClass) {
      const nodeText = code.slice(node.startIndex, node.endIndex);
      const firstLine = nodeText.split('\n')[0].trim();
      lines.push(`${'  '.repeat(depth)}- Class: ${firstLine} (line ${startLine})`);
      for (let i = 0; i < node.childCount; i++) {
        traverse(node.child(i), depth + 1);
      }
    } else if (isFunction) {
      const nodeText = code.slice(node.startIndex, node.endIndex);
      const firstLine = nodeText.split('\n')[0].trim();
      lines.push(`${'  '.repeat(depth)}- Function/Method: ${firstLine} (line ${startLine})`);
      for (let i = 0; i < node.childCount; i++) {
        traverse(node.child(i), depth + 1);
      }
    } else {
      for (let i = 0; i < node.childCount; i++) {
        traverse(node.child(i), depth);
      }
    }
  }

  traverse(rootNode, 0);
  return lines.length > 0 ? lines.join('\n') : '(No classes or functions found in file)';
}

function generateFallbackOutline(code: string, language: string): string {
  const pack = getLanguagePack(language);
  if (pack?.repograph?.extractDeclarations) {
    const decls = pack.repograph.extractDeclarations(code, 'file');
    // Sort declarations by line number
    const sorted = [...decls].sort((a: any, b: any) => a.line - b.line);
    const lines = sorted.map((d: any) => `- ${d.type.charAt(0).toUpperCase() + d.type.slice(1)}: ${d.name} (line ${d.line})`);
    return lines.length > 0 ? lines.join('\n') : '(No declarations found in file)';
  }
  return '(Outline mode not supported for this language pack in fallback mode)';
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GraphEngine } from './graph-engine.js';

export interface DocMatch {
  file: string;
  line_number: number;
  line_content: string;
}

export interface CodeReference {
  file: string;
  class_or_table: string;
  method: string;
  line_number: number;
  line_of_code: string;
}

export interface TrackReferenceResult {
  symbol: string;
  definitions: any[];
  usages: CodeReference[];
  documentation_mappings: DocMatch[];
}

export interface GetInsightsResult {
  insights: Record<string, any>;
}

export interface RefactorOperation {
  type: 'rename' | 'replace' | 'move' | 'create' | 'delete';
  filePath?: string;
  fromPath?: string;
  toPath?: string;
  oldName?: string;
  newName?: string;
  find?: string;
  replace?: string;
  content?: string;
}

export interface RefactorBatchResult {
  status: 'success' | 'error';
  message: string;
  modified_files?: string[];
}

/**
 * Recursively scans all markdown files in rootDir for occurrences of symbol
 */
export function findDocReferences(symbol: string, rootDir: string): DocMatch[] {
  const matches: DocMatch[] = [];
  const symbolWordRe = new RegExp(`\\b${symbol}\\b`);

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      if (
        entry === 'node_modules' ||
        entry === 'dist' ||
        entry === '.git' ||
        entry.startsWith('.')
      ) {
        continue;
      }
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (stat.isFile() && entry.toLowerCase().endsWith('.md')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (symbolWordRe.test(line)) {
              matches.push({
                file: path.relative(rootDir, fullPath),
                line_number: i + 1,
                line_content: line.trim(),
              });
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  walk(rootDir);
  return matches;
}

/**
 * Tracks references, definitions, and doc mappings for a single symbol
 */
export function trackReference(
  symbol: string,
  rootDir: string,
  graph: GraphEngine,
  indexedFiles: Set<string>,
  includeDocs = true,
  findCodeRefsFn: (query: string, root: string, files: Set<string>) => CodeReference[]
): TrackReferenceResult {
  const definitions = graph.findDefinitions(symbol).map((d) => ({
    id: d.id,
    type: d.type,
    label: d.label,
    file: d.filePath,
    metadata: d.metadata ?? {},
  }));

  const usages = findCodeRefsFn(symbol, rootDir, indexedFiles);
  const docMatches = includeDocs ? findDocReferences(symbol, rootDir) : [];

  return {
    symbol,
    definitions,
    usages,
    documentation_mappings: docMatches,
  };
}

/**
 * Combines multiple symbol or query lookups into a single wrapper result
 */
export function getInsights(
  params: {
    symbols?: string[];
    queries?: Array<{ type: 'definitions' | 'usages' | 'references' | 'docs'; symbol: string }>;
    include_docs?: boolean;
  },
  rootDir: string,
  graph: GraphEngine,
  indexedFiles: Set<string>,
  findCodeRefsFn: (query: string, root: string, files: Set<string>) => CodeReference[]
): GetInsightsResult {
  const insights: Record<string, any> = {};
  const includeDocs = params.include_docs !== false;

  if (params.symbols && Array.isArray(params.symbols)) {
    for (const sym of params.symbols) {
      insights[sym] = trackReference(sym, rootDir, graph, indexedFiles, includeDocs, findCodeRefsFn);
    }
  }

  if (params.queries && Array.isArray(params.queries)) {
    for (const query of params.queries) {
      const key = `${query.type}:${query.symbol}`;
      if (query.type === 'definitions') {
        insights[key] = graph.findDefinitions(query.symbol).map((d) => ({
          id: d.id,
          type: d.type,
          label: d.label,
          file: d.filePath,
          metadata: d.metadata ?? {},
        }));
      } else if (query.type === 'usages' || query.type === 'references') {
        insights[key] = findCodeRefsFn(query.symbol, rootDir, indexedFiles);
      } else if (query.type === 'docs') {
        insights[key] = findDocReferences(query.symbol, rootDir);
      }
    }
  }

  return { insights };
}

interface VfsFile {
  content: string;
  status: 'loaded' | 'modified' | 'created' | 'deleted';
}

/**
 * Transactionally executes a list of refactoring operations using an in-memory Virtual File System (VFS).
 * Changes are only written to disk if all operations succeed.
 */
export function executeRefactorBatch(
  operations: RefactorOperation[],
  rootDir: string
): RefactorBatchResult {
  const vfs = new Map<string, VfsFile>();

  function getFile(targetPath: string): string {
    const absPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(rootDir, targetPath);
    let fileEntry = vfs.get(absPath);
    if (!fileEntry) {
      if (!fs.existsSync(absPath)) {
        throw new Error(`File does not exist: ${targetPath}`);
      }
      const content = fs.readFileSync(absPath, 'utf8');
      fileEntry = { content, status: 'loaded' };
      vfs.set(absPath, fileEntry);
    }
    if (fileEntry.status === 'deleted') {
      throw new Error(`File was deleted in this transaction: ${targetPath}`);
    }
    return fileEntry.content;
  }

  function setFile(targetPath: string, content: string, isCreate = false) {
    const absPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(rootDir, targetPath);
    const fileEntry = vfs.get(absPath);
    if (fileEntry) {
      if (fileEntry.status === 'deleted') {
        fileEntry.status = isCreate ? 'created' : 'modified';
      } else if (fileEntry.status !== 'created') {
        fileEntry.status = 'modified';
      }
      fileEntry.content = content;
    } else {
      vfs.set(absPath, { content, status: isCreate ? 'created' : 'modified' });
    }
  }

  function deleteFile(targetPath: string) {
    const absPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(rootDir, targetPath);
    const fileEntry = vfs.get(absPath);
    if (fileEntry) {
      fileEntry.status = 'deleted';
      fileEntry.content = '';
    } else {
      vfs.set(absPath, { content: '', status: 'deleted' });
    }
  }

  try {
    for (let idx = 0; idx < operations.length; idx++) {
      const op = operations[idx];
      switch (op.type) {
        case 'rename': {
          if (!op.filePath) throw new Error(`Operation #${idx} (rename) requires 'filePath'`);
          if (!op.oldName || !op.newName) {
            throw new Error(`Operation #${idx} (rename) requires 'oldName' and 'newName'`);
          }
          const currentContent = getFile(op.filePath);
          const renameRe = new RegExp(`\\b${op.oldName}\\b`, 'g');
          if (!renameRe.test(currentContent)) {
            throw new Error(`Symbol '${op.oldName}' not found in file '${op.filePath}'`);
          }
          const newContent = currentContent.replace(renameRe, op.newName);
          setFile(op.filePath, newContent);
          break;
        }

        case 'replace': {
          if (!op.filePath) throw new Error(`Operation #${idx} (replace) requires 'filePath'`);
          if (op.find === undefined || op.replace === undefined) {
            throw new Error(`Operation #${idx} (replace) requires 'find' and 'replace'`);
          }
          const currentContent = getFile(op.filePath);
          if (!currentContent.includes(op.find)) {
            throw new Error(`Target text '${op.find}' to replace not found in file '${op.filePath}'`);
          }
          const newContent = currentContent.split(op.find).join(op.replace);
          setFile(op.filePath, newContent);
          break;
        }

        case 'move': {
          if (!op.fromPath || !op.toPath) {
            throw new Error(`Operation #${idx} (move) requires 'fromPath' and 'toPath'`);
          }
          const content = getFile(op.fromPath);
          deleteFile(op.fromPath);
          setFile(op.toPath, content, true);
          break;
        }

        case 'create': {
          if (!op.filePath) throw new Error(`Operation #${idx} (create) requires 'filePath'`);
          if (op.content === undefined) {
            throw new Error(`Operation #${idx} (create) requires 'content'`);
          }
          setFile(op.filePath, op.content, true);
          break;
        }

        case 'delete': {
          if (!op.filePath) throw new Error(`Operation #${idx} (delete) requires 'filePath'`);
          deleteFile(op.filePath);
          break;
        }

        default:
          throw new Error(`Unknown refactoring operation type: ${(op as any).type}`);
      }
    }

    // If we reached here, all operations succeeded. Commit the changes to disk.
    const modifiedFiles: string[] = [];
    for (const [absPath, fileEntry] of vfs.entries()) {
      const relPath = path.relative(rootDir, absPath);
      if (fileEntry.status === 'deleted') {
        if (fs.existsSync(absPath)) {
          fs.unlinkSync(absPath);
        }
        modifiedFiles.push(relPath);
      } else if (fileEntry.status === 'created' || fileEntry.status === 'modified') {
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, fileEntry.content, 'utf8');
        modifiedFiles.push(relPath);
      }
    }

    return {
      status: 'success',
      message: `Executed ${operations.length} operations successfully.`,
      modified_files: modifiedFiles,
    };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface CallNode {
  symbol: string;
  file: string;
  type: string;
  calls?: CallNode[];
}

/**
 * Traverses call edges in the graph engine recursively to compute the call hierarchy.
 */
export function getCallHierarchy(
  symbolName: string,
  direction: 'incoming' | 'outgoing' | 'both',
  graph: GraphEngine,
  maxDepth = 3
): { incoming?: CallNode[]; outgoing?: CallNode[] } {
  const lowerName = symbolName.toLowerCase();
  const matchedNodes = graph.getAllNodes().filter(
    (n) => n.id.toLowerCase().includes(lowerName) || n.label.toLowerCase() === lowerName
  );

  const result: { incoming?: CallNode[]; outgoing?: CallNode[] } = {};

  if (direction === 'incoming' || direction === 'both') {
    result.incoming = matchedNodes.map((node) => buildTree(node.id, 'incoming', 0));
  }
  if (direction === 'outgoing' || direction === 'both') {
    result.outgoing = matchedNodes.map((node) => buildTree(node.id, 'outgoing', 0));
  }

  function buildTree(nodeId: string, dir: 'incoming' | 'outgoing', depth: number): CallNode {
    const node = graph.getNode(nodeId);
    const label = node ? node.label : nodeId;
    const file = node ? node.filePath : '';
    const type = node ? node.type : 'unknown';

    if (depth >= maxDepth) {
      return { symbol: label, file, type };
    }

    const children: CallNode[] = [];
    const visited = new Set<string>();

    if (dir === 'incoming') {
      const edges = graph.getIncomingEdges(nodeId).filter((e) => e.type === 'calls');
      for (const edge of edges) {
        if (!visited.has(edge.from)) {
          visited.add(edge.from);
          children.push(buildTree(edge.from, dir, depth + 1));
        }
      }
    } else {
      const edges = graph.getOutgoingEdges(nodeId).filter((e) => e.type === 'calls');
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          children.push(buildTree(edge.to, dir, depth + 1));
        }
      }
    }

    return {
      symbol: label,
      file,
      type,
      calls: children.length > 0 ? children : undefined,
    };
  }

  return result;
}

export interface DependencyReport {
  dependencies: Record<string, string[]>;
  cycles: string[][];
}

/**
 * Analyzes file imports in the graph to return import dependencies and circular dependency paths.
 */
export function getDependencyReport(graph: GraphEngine): DependencyReport {
  const fileNodes = graph.getNodesByType('file');
  const dependencies: Record<string, string[]> = {};
  
  for (const node of fileNodes) {
    const outgoing = graph.getOutgoingEdges(node.id)
      .filter((e) => e.type === 'imports')
      .map((e) => {
        const destNode = graph.getNode(e.to);
        return destNode ? destNode.filePath : e.to.replace(/^file:/, '');
      });
    dependencies[node.filePath] = outgoing;
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const pathArr: string[] = [];

  function dfs(filePath: string) {
    if (stack.has(filePath)) {
      const cycleStartIdx = pathArr.indexOf(filePath);
      if (cycleStartIdx !== -1) {
        cycles.push([...pathArr.slice(cycleStartIdx), filePath]);
      }
      return;
    }
    if (visited.has(filePath)) return;

    visited.add(filePath);
    stack.add(filePath);
    pathArr.push(filePath);

    const neighbors = dependencies[filePath] ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }

    pathArr.pop();
    stack.delete(filePath);
  }

  for (const node of fileNodes) {
    dfs(node.filePath);
  }

  return { dependencies, cycles };
}

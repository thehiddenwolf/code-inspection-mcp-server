import type { PatternMatchType } from '@hermes/shared/schemas/patterns.js';
import type { Finding, ScanReport, PatternFilter } from './types.js';
import catalog from './patterns/catalog.js';
import { parseRegexString, type LanguagePack, LanguagePackRegistry } from '@hermes/shared';


export interface ScanOptions {
  directory: string;
  extensions?: string[];
  exclude?: string[];
  filter?: PatternFilter;
}


/**
 * Dynamic detector for declarative custom patterns.
 */
export async function detectCustomPattern(
  patternDef: any,
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];
  
  let regex: RegExp;
  try {
    regex = parseRegexString(patternDef.pattern, 'g');
  } catch (err) {
    const escaped = patternDef.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, 'g');
  }

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    let match: RegExpExecArray | null;
    
    regex.lastIndex = 0;
    
    while ((match = regex.exec(file.content)) !== null) {
      const matchedIndex = match.index;
      const beforeMatch = file.content.substring(0, matchedIndex);
      const splitLines = beforeMatch.split(/\r?\n/);
      const lineNum = splitLines.length;
      const column = splitLines[splitLines.length - 1]?.length || 0;
      
      const lineText = lines[lineNum - 1] || '';
      const snippet = lineText.trim().substring(0, 100);

      let message = patternDef.message_template || `Custom pattern violation: ${patternDef.name}`;
      if (message.includes('${value}')) {
        message = message.replace('${value}', match[0]);
      }
      if (message.includes('${snippet}')) {
        message = message.replace('${snippet}', snippet);
      }

      findings.push({
        pattern_id: patternDef.id,
        pattern_name: patternDef.name,
        file_path: file.path,
        line: lineNum,
        column,
        message,
        severity: patternDef.severity,
        category: patternDef.category,
        snippet,
      });
    }
  }
  return findings;
}

/**
 * Main scan orchestrator.
 * Walks file paths, runs pattern matchers, returns findings with severity scoring.
 */
export async function runScan(options: ScanOptions): Promise<ScanReport> {
  const startTime = Date.now();
  const scanId = `scan_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  // Collect files
  const fs = await import('fs');
  const path = await import('path');

  const extensions = options.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py'];
  const excludePatterns = options.exclude ?? ['node_modules', '.git', 'dist', 'build', 'coverage', '.next'];

  function walkDir(dir: string): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!excludePatterns.includes(entry.name)) {
            results.push(...walkDir(fullPath));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch {
      // Permission denied, etc. — skip
    }
    return results;
  }

  const filePaths = walkDir(options.directory);
  const files = filePaths.map(fp => ({
    path: fp,
    content: fs.readFileSync(fp, 'utf-8'),
  }));

  // Run all pattern detectors
  const allMatches: PatternMatchType[] = [];

  const packs = LanguagePackRegistry.getInstance().getAll();
  const customPacksPatterns = packs.flatMap(p => p.patternMiner?.patterns ?? []);

  const allEntriesToScan = [
    ...catalog,
    ...customPacksPatterns.map(p => ({
      definition: p,
      detector: (files: { path: string; content: string }[]) => detectCustomPattern(p, files)
    }))
  ];

  for (const entry of allEntriesToScan) {
    // Apply filter
    if (options.filter) {
      if (options.filter.categories && !options.filter.categories.includes(entry.definition.category)) continue;
      if (options.filter.severities && !options.filter.severities.includes(entry.definition.severity)) continue;
      if (options.filter.languages) {
        const fileHasMatchingLang = files.some(f => {
          const ext = path.extname(f.path).toLowerCase();
          const langMap: Record<string, string> = {
            '.ts': 'typescript', '.tsx': 'typescript',
            '.js': 'javascript', '.jsx': 'javascript',
            '.mjs': 'javascript', '.cjs': 'javascript',
            '.mts': 'typescript', '.cts': 'typescript',
            '.py': 'python',
          };
          const lang = langMap[ext] || '';
          return entry.definition.languages.includes(lang) && options.filter!.languages!.includes(lang);
        });
        if (!fileHasMatchingLang) continue;
      }
      if (options.filter.patternIds && !options.filter.patternIds.includes(entry.definition.id)) continue;
    }

    try {
      // Filter files that match the pattern's languages
      const langFilteredFiles = files.filter(f => {
        const ext = path.extname(f.path).toLowerCase();
        const langMap: Record<string, string> = {
          '.ts': 'typescript', '.tsx': 'typescript',
          '.js': 'javascript', '.jsx': 'javascript',
          '.mjs': 'javascript', '.cjs': 'javascript',
          '.mts': 'typescript', '.cts': 'typescript',
          '.py': 'python',
          '.java': 'java', '.kt': 'java',
        };
        const lang = langMap[ext] || '';
        return entry.definition.languages.includes(lang);
      });

      const matches = await entry.detector(langFilteredFiles);
      allMatches.push(...matches);
    } catch (err) {
      // Log detector error and continue
      console.error(`[pattern-miner] Error running detector '${entry.definition.id}':`, err);
    }
  }

  // Convert to findings
  const findings: Finding[] = allMatches.map(m => ({
    patternId: m.pattern_id,
    patternName: m.pattern_name,
    filePath: m.file_path || '',
    line: m.line,
    column: m.column,
    endLine: m.end_line,
    message: m.message,
    severity: m.severity,
    category: m.category,
    snippet: m.snippet,
  }));

  // Aggregate by severity
  const findingsBySeverity: Record<string, number> = {};
  for (const f of findings) {
    findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] || 0) + 1;
  }

  const durationMs = Date.now() - startTime;

  return {
    scanId,
    timestamp: new Date().toISOString(),
    filesScanned: files.length,
    totalFindings: findings.length,
    findingsBySeverity,
    findings,
    durationMs,
  };
}



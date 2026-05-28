import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Detect function definitions that are never called anywhere in the project.
 * Works by collecting all function/arrow function definitions and checking
 * if they're ever referenced by name elsewhere.
 */
export async function detectOrphanedFunctions(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Collect all named function definitions
  const namedFunctions = new Map<string, { path: string; line: number; snippet: string }[]>();

  // Collect all function calls / references
  const calledFunctions = new Set<string>();

  // Patterns for function definitions
  const funcDefRegex = /(?:^|\s)(?:async\s+)?function\s+(\w+)\s*\(/gm;
  const constFuncRegex = /(?:^|\s)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*(?:=>|\.\w+\(|function\b)/gm;
  const methodRegex = /(?:^|\s)(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/gm;
  const classMethodRegex = /^\s*(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*\{/gm;

  // Patterns for function calls
  const callRegex = /(?:\b(\w+)\s*\()/g;

  for (const file of files) {
    const lines = file.content.split('\n');

    // Reset regexes
    funcDefRegex.lastIndex = 0;
    constFuncRegex.lastIndex = 0;
    classMethodRegex.lastIndex = 0;
    callRegex.lastIndex = 0;

    // Find function definitions
    let match: RegExpExecArray | null;

    // Named function declarations
    while ((match = funcDefRegex.exec(file.content)) !== null) {
      const name = match[1];
      const lineNum = file.content.substring(0, match.index).split('\n').length;
      if (!namedFunctions.has(name)) namedFunctions.set(name, []);
      namedFunctions.get(name)!.push({
        path: file.path,
        line: lineNum,
        snippet: match[0].substring(0, 80),
      });
    }

    // Const arrow functions / function expressions
    while ((match = constFuncRegex.exec(file.content)) !== null) {
      const name = match[1];
      const lineNum = file.content.substring(0, match.index).split('\n').length;
      if (!namedFunctions.has(name)) namedFunctions.set(name, []);
      namedFunctions.get(name)!.push({
        path: file.path,
        line: lineNum,
        snippet: match[0].substring(0, 80),
      });
    }

    // Find function calls
    while ((match = callRegex.exec(file.content)) !== null) {
      const name = match[1];
      // Exclude keywords and common constructs
      if (!/^(if|for|while|switch|catch|return|throw|typeof|instanceof|delete|void|await|yield|import|export|new|function|class|case|in|of)$/.test(name)) {
        calledFunctions.add(name);
      }
    }

    // Class methods (heuristic - detect methods in class bodies)
    let braceDepth = 0;
    let inClass = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/\bclass\s+\w+/.test(line)) inClass = true;
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0) inClass = false;

      if (inClass) {
        classMethodRegex.lastIndex = 0;
        while ((match = classMethodRegex.exec(line)) !== null) {
          const name = match[1];
          // Skip constructor and lifecycle methods
          if (['constructor', 'render', 'componentDidMount', 'componentDidUpdate', 'componentWillUnmount', 'useEffect', 'useState', 'toString', 'valueOf'].includes(name)) continue;
          if (!namedFunctions.has(name)) namedFunctions.set(name, []);
          namedFunctions.get(name)!.push({
            path: file.path,
            line: i + 1,
            snippet: line.trim().substring(0, 80),
          });
        }
      }
    }
  }

  // Now check which defined functions are never called
  // Add common callbacks/lifecycle methods to exclude
  const knownCallbacks = new Set([
    'constructor', 'render', 'useEffect', 'useState', 'useCallback', 'useMemo',
    'useRef', 'useContext', 'useReducer', 'useLayoutEffect',
    'componentDidMount', 'componentDidUpdate', 'componentWillUnmount',
    'getDerivedStateFromProps', 'shouldComponentUpdate', 'getSnapshotBeforeUpdate',
    'componentDidCatch', 'getDerivedStateFromError',
    'init', 'setup', 'teardown', 'main', 'handler', 'handle',
    'onClick', 'onChange', 'onSubmit', 'onKeyDown', 'onKeyUp', 'onMouseDown',
    'onMouseUp', 'onMouseMove', 'onFocus', 'onBlur', 'onLoad',
    'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
    'describe', 'it', 'test', 'expect',
    'exports', 'module', 'require', 'define',
    'then', 'catch', 'finally',
  ]);

  for (const [name, defs] of namedFunctions) {
    // Skip known callbacks / lifecycle hooks
    if (knownCallbacks.has(name)) continue;

    // If function is defined but never called
    if (!calledFunctions.has(name)) {
      for (const def of defs) {
        findings.push({
          pattern_id: 'orphaned-functions',
          pattern_name: 'Orphaned Function',
          file_path: def.path,
          line: def.line,
          column: 0,
          message: `Function '${name}' is defined but never called`,
          severity: 'warning' as PatternSeverityType,
          category: 'dead_code' as PatternCategoryType,
          snippet: def.snippet,
        });
      }
    }
  }

  return findings;
}

import { LanguagePackRegistry } from '@hermes/shared';
import * as path from 'node:path';

const DEFAULT_CONCERN_PATTERNS = {
  database: [/db\./, /\.query\(/, /\.find\(/, /\.save\(/, /\.update\(/, /\.delete\(/, /repository/, /\.insert\(/, /\.create\(/, /\.findOne\(/, /\.findAll\(/],
  ui: [/\.render\(/, /\.display\(/, /formatHTML/, /\.innerHTML/, /createElement/, /\.appendChild/, /document\./, /window\./, /\.show\(/, /\.alert\(/, /console\.log/],
  business_logic: [/calculate/, /compute/, /validate/, /process/, /transform/, /\.map\(/, /\.filter\(/, /\.reduce\(/, /\bapply\b/, /\brules?\b/, /\bpolicy\b/],
  external_service: [/fetch\(/, /axios/, /http\./, /\.post\(/, /\.get\(/, /sendEmail/, /\.send\(/, /api\./, /request\(/, /\.emit\(/, /publish/],
  logging: [/logger\./, /log\.info/, /log\.error/, /log\.warn/, /console\.log/, /console\.error/],
  file_io: [/fs\./, /readFile/, /writeFile/, /\.pipe\(/, /stream/],
  serialization: [/JSON\.stringify/, /JSON\.parse/, /\.toString\(/, /serialize/, /deserialize/],
};

const DEFAULT_VALUE_OBJECT_PATTERNS = [
  /^[A-Z]\w*(?:Dto|DTO|ValueObject|Vo|VO|Data|Record|Model|Entity|Event|Message|Request|Response|Result|Error|Config|Options|Settings|Props|State|Input|Output)$/,
  /^(?:string|number|boolean|Date|RegExp|Map|Set|Array|Object|Promise|Error)$/,
];

const DEFAULT_NOT_IMPLEMENTED_PATTERNS = [
  /throw\s+(?:new\s+)?(?:NotImplementedError|Error)\s*\(\s*['"`][^'"`]*not\s+implemented[^'"`]*['"`]/gi,
  /throw\s+(?:new\s+)?(?:Error|NotImplementedError)\s*\(\s*['"`](?:TODO|stub|impl[^'"`]*|)['"`]\)/i,
  /throw\s+(?:new\s+)?NotImplementedError\b/i,
];

export function getEnforcerRules(file: string) {
  const ext = path.extname(file);
  const pack = LanguagePackRegistry.getInstance().lookup(ext);
  const solid = pack?.solidEnforcer;

  return {
    classRegex: solid?.classRegex ?? /class\s+(\w+)\s*(?:extends\s+\w+\s*)?(?:implements\s+[\w\s,]+)?\s*\{/g,
    derivedClassRegex: solid?.derivedClassRegex ?? /class\s+(\w+)\s+extends\s+(\w+)(?:<[^>]*>)?\s*\{/g,
    interfaceRegex: solid?.interfaceRegex ?? /interface\s+(\w+)\s*(?:extends\s+[\w,\s]+)?\{/g,
    concernPatterns: solid?.concernPatterns ?? DEFAULT_CONCERN_PATTERNS,
    notImplementedPatterns: solid?.notImplementedPatterns ?? DEFAULT_NOT_IMPLEMENTED_PATTERNS,
    newInstantiationRegex: solid?.newInstantiationRegex ?? /new\s+([A-Z]\w+)\s*\(/g,
    staticCallRegex: solid?.staticCallRegex ?? /([A-Z]\w+)\.(\w+)\s*\(/g,
    valueObjectPatterns: solid?.valueObjectPatterns ?? DEFAULT_VALUE_OBJECT_PATTERNS,
  };
}

import type { LanguagePack } from '../types/language-pack.js';

export const pack: LanguagePack = {
  metadata: {
    name: 'json',
    version: '1.0.0',
    fileExtensions: ['.json'],
  },
  supportedLanguages: ['json', '.json'],
  fileExtensions: ['.json'],
  parserName: 'json-parser',
  regexPatterns: {
    commentDetection: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  rules: {
    comment: { action: 'strip' },
  },
  lintFix: {
    commands: [
      ['npx', 'prettier', '--write'],
    ],
  },
};

export default pack;

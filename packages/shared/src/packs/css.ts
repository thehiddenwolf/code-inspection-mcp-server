import type { LanguagePack } from '../types/language-pack.js';

export const pack: LanguagePack = {
  metadata: {
    name: 'css',
    version: '1.0.0',
    fileExtensions: ['.css'],
  },
  supportedLanguages: ['css', '.css'],
  fileExtensions: ['.css'],
  parserName: 'css-parser',
  regexPatterns: {
    commentDetection: /\/\*[\s\S]*?\*\//g,
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


import type { LanguagePack } from '../types/language-pack.js';

export const pack: LanguagePack = {
  metadata: {
    name: 'yaml',
    version: '1.0.0',
    fileExtensions: ['.yaml', '.yml'],
  },
  supportedLanguages: ['yaml', 'yml', '.yaml', '.yml'],
  fileExtensions: ['.yaml', '.yml'],
  parserName: 'yaml-parser',
  regexPatterns: {
    commentDetection: /#[^\n]*/g,
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


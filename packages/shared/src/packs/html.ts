import type { LanguagePack } from '../types/language-pack.js';

export const pack: LanguagePack = {
  metadata: {
    name: 'html',
    version: '1.0.0',
    fileExtensions: ['.html'],
  },
  supportedLanguages: ['html', '.html'],
  fileExtensions: ['.html'],
  parserName: 'html-parser',
  regexPatterns: {
    commentDetection: /<!--[\s\S]*?-->/g,
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

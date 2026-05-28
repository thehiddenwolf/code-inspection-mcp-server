import type { LanguagePack } from '../types/language-pack.js';

export const pack: LanguagePack = {
  metadata: {
    name: 'markdown',
    version: '1.0.0',
    fileExtensions: ['.md'],
  },
  supportedLanguages: ['markdown', 'md', '.md'],
  fileExtensions: ['.md'],
  parserName: 'markdown-parser',
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

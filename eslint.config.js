// ESLint flat config — v10.x compatible
// See CODE-REVIEW-GUIDELINES.md for SOLID-specific manual review guidance.

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/prefer-as-const': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn',
      'no-console': 'off',

      // SonarJS — code smell rules relevant to SOLID
      'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
      'sonarjs/cognitive-complexity': ['warn', 15],
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/prefer-single-boolean-return': 'warn',
      'sonarjs/no-small-switch': 'warn',
      'sonarjs/no-inverted-boolean-check': 'warn',
      'sonarjs/max-union-size': ['warn', { threshold: 5 }],

      // Downgrade high-noise non-SOLID rules to warn for CI compatibility
      'sonarjs/slow-regex': 'warn',
      'sonarjs/regex-complexity': 'warn',
      'sonarjs/prefer-regexp-exec': 'warn',
      'sonarjs/unused-import': 'warn',
      'sonarjs/no-dead-store': 'warn',
      'sonarjs/deprecation': 'warn',
      'sonarjs/no-alphabetical-sort': 'warn',
      'sonarjs/no-ignored-exceptions': 'warn',
      'sonarjs/todo-tag': 'warn',
      'sonarjs/no-unused-vars': 'warn',
      'sonarjs/pseudo-random': 'warn',
      'sonarjs/os-command': 'warn',
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/use-type-alias': 'warn',
      '@typescript-eslint/no-base-to-string': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/prefer-promise-reject-errors': 'warn',
      'no-irregular-whitespace': 'warn',
      'no-constant-binary-expression': 'warn',
      'no-constant-condition': 'warn',
      'prefer-const': 'warn',
      'sonarjs/single-character-alternation': 'warn',
      'sonarjs/no-redundant-jump': 'warn',
      'sonarjs/different-types-comparison': 'warn',
      'sonarjs/no-os-command-from-path': 'warn',
      'sonarjs/no-nested-assignment': 'warn',
      'sonarjs/no-unused-collection': 'warn',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '**/*.js', '**/*.cjs'],
  },
);

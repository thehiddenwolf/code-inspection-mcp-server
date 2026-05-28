module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'sonarjs'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:sonarjs/recommended-legacy',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': 'off',

    // SonarJS — code smell rules relevant to SOLID
    'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
    'sonarjs/cognitive-complexity': ['warn', 15],
    'sonarjs/no-identical-functions': 'warn',
    'sonarjs/prefer-single-boolean-return': 'warn',
    'sonarjs/no-small-switch': 'warn',
    'sonarjs/no-collection-size-mischeck': 'warn',
    'sonarjs/no-inverted-boolean-check': 'warn',

    // These are informative — reduce noise by keeping them light
    'sonarjs/max-union-size': ['warn', 5],
  },
  ignorePatterns: ['dist', 'node_modules', '*.js', '*.cjs'],
};

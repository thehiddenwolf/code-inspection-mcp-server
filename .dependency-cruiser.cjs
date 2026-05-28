/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* === DIP — Architectural Boundary Rules === */

    // Shared must not depend on any other package
    {
      name: 'shared-no-deps',
      comment: 'The shared package must be a leaf — no package imports from @hermes/shared',
      severity: 'error',
      from: { path: '^packages/shared/src/' },
      to: { path: '^packages/(?!shared/src/)', pathNot: '\\.(test|spec)\\.ts$' },
    },

    // Core packages must not depend on CLI
    {
      name: 'no-package-depends-on-cli',
      comment: 'Core packages must not depend on the CLI layer',
      severity: 'error',
      from: { path: '^packages/(?!cli/src/|shared/src/)' },
      to: { path: '^packages/cli/src/' },
    },

    // Solid-enforcer must not depend on higher-level packages (except shared)
    {
      name: 'solid-enforcer-leaf',
      comment: 'Solid-enforcer is a leaf tool — must not import from other packages (except shared)',
      severity: 'error',
      from: { path: '^packages/solid-enforcer/src/' },
      to: {
        path: [
          '^packages/pattern-miner/',
          '^packages/task-router/',
          '^packages/repograph/',
          '^packages/architecture-shepherd/',
          '^packages/mcp-gateway/',
          '^packages/token-squeezer/',
        ],
        pathNot: '\\.(test|spec)\\.ts$',
      },
    },

    // Architecture-shepherd must not depend on higher-order packages
    {
      name: 'shepherd-no-higher-order',
      comment: 'Architecture-shepherd is foundational — no importing higher-order packages',
      severity: 'error',
      from: { path: '^packages/architecture-shepherd/src/' },
      to: {
        path: [
          '^packages/pattern-miner/',
          '^packages/task-router/',
          '^packages/repograph/',
        ],
        pathNot: '\\.(test|spec)\\.ts$',
      },
    },

    // Detect circular dependencies (DIP smell)
    {
      name: 'no-circular',
      comment: 'Circular dependencies violate DIP — extract shared abstractions',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'default'],
    },
    exclude: {
      path: [
        'node_modules',
        'dist',
        '\\.test\\.ts$',
        '\\.spec\\.ts$',
        'vitest\\.config',
      ],
    },
  },
};

#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { checkSingleResponsibility } from './rules/single-responsibility.js';
import { checkOpenClosed } from './rules/open-closed.js';
import { checkLiskovSubstitution } from './rules/liskov.js';
import { checkInterfaceSegregation } from './rules/interface-segregation.js';
import { checkDependencyInversion } from './rules/dependency-inversion.js';
import type { ViolationType } from '@hermes/shared/schemas/violations.js';
import type { SolidPrinciple, CheckResult, PrincipleResult } from './types.js';
import { ALL_PRINCIPLES, PRINCIPLE_LABELS } from './types.js';

/**
 * @hermes/solid-enforcer MCP Server
 *
 * Provides two tools:
 *   solid_enforcer.check        — Check a file for all SOLID violations
 *   solid_enforcer.check_single — Check a single principle only
 */

const server = new McpServer({
  name: '@hermes/solid-enforcer',
  version: '0.1.0',
});

// ── Shared: run one principle check ──────────────────────
function runPrincipleCheck(
  principle: SolidPrinciple,
  code: string,
  file: string,
): ViolationType[] {
  switch (principle) {
    case 'single_responsibility':
      return checkSingleResponsibility(code, file);
    case 'open_closed':
      return checkOpenClosed(code, file);
    case 'liskov_substitution':
      return checkLiskovSubstitution(code, file);
    case 'interface_segregation':
      return checkInterfaceSegregation(code, file);
    case 'dependency_inversion':
      return checkDependencyInversion(code, file);
  }
}

// ── Shared: compute score from violations ────────────────
function computeScore(violations: ViolationType[]): number {
  if (violations.length === 0) return 1.0;
  const severityWeights: Record<string, number> = {
    critical: 0.4,
    error: 0.25,
    warning: 0.15,
    info: 0.05,
  };
  let penalty = 0;
  for (const v of violations) {
    penalty += severityWeights[v.severity] ?? 0.1;
  }
  return Math.max(0, Math.min(1, 1 - penalty));
}

// ── Tool: solid_enforcer.check ──────────────────────────
server.registerTool(
  'solid_enforcer.check',
  {
    description: 'Analyze a file for all five SOLID principle violations. Returns detailed results including which principles pass/fail, line-level violations, and remediation suggestions.',
    inputSchema: {
      file: z.string().describe('Absolute or relative path to the file being checked'),
      code: z.string().describe('Source code content to analyze'),
    },
  },
  async (args: { file: string; code: string }) => {
    try {
      const results: PrincipleResult[] = [];
      const allViolations: ViolationType[] = [];

      for (const principle of ALL_PRINCIPLES) {
        const violations = runPrincipleCheck(principle, args.code, args.file);
        allViolations.push(...violations);
        results.push({
          principle,
          label: PRINCIPLE_LABELS[principle],
          passed: violations.length === 0,
          violations,
          score: computeScore(violations),
        });
      }

      const result: CheckResult = {
        file: args.file,
        passed: allViolations.length === 0,
        violations: allViolations,
        results,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error running SOLID check: ${message}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: solid_enforcer.check_single ───────────────────
server.registerTool(
  'solid_enforcer.check_single',
  {
    description: 'Check a single SOLID principle in a file. Use when you only need one principle checked rather than all five.',
    inputSchema: {
      file: z.string().describe('Absolute or relative path to the file being checked'),
      code: z.string().describe('Source code content to analyze'),
      principle: z.enum([
        'single_responsibility',
        'open_closed',
        'liskov_substitution',
        'interface_segregation',
        'dependency_inversion',
      ] as const).describe('The SOLID principle to check'),
    },
  },
  async (args: { file: string; code: string; principle: SolidPrinciple }) => {
    try {
      const violations = runPrincipleCheck(args.principle, args.code, args.file);

      const result: PrincipleResult = {
        principle: args.principle,
        label: PRINCIPLE_LABELS[args.principle],
        passed: violations.length === 0,
        violations,
        score: computeScore(violations),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error running single-principle check: ${message}` }],
        isError: true,
      };
    }
  },
);

// ── Start server ────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('Fatal error starting solid-enforcer server:', err);
  process.exit(1);
});

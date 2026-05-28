#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  AnalysisTargetSchema,
  ComplexityScoreSchema,
  MetricResultSchema,
  TaskSchema,
  ThresholdOverridesSchema,
} from './types.js';
import { Analyzer } from './analyzer.js';
import { RoutingTable } from './routing-table.js';
import { Decomposer } from './decomposer.js';
import { estimateComplexity, extractSubtasks } from './estimator.js';
import { Metric } from './metrics/metric.js';
import { MetricRegistry } from './metrics/registry.js';
import { CyclomaticMetric } from './metrics/cyclomatic.js';
import { DependencyMetric } from './metrics/dependencies.js';
import { InterfaceSurfaceMetric } from './metrics/interface-surface.js';
import { LocImpactMetric } from './metrics/loc-impact.js';
import { DensityMetric } from './metrics/density.js';
import { ComplexityClassifier, RoutingRequest } from './router.js';
import { RouterConfig, loadRouterConfig, DEFAULT_ROUTER_CONFIG } from './router-config.js';

const PACKAGE_NAME = '@hermes/task-router';
const PACKAGE_VERSION = '0.1.0';

// ---- MCP Server setup ----

const server = new Server(
  {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ---- Tool implementations ----

const analyzer = new Analyzer();
const decomposer = new Decomposer();
const routingTable = new RoutingTable();

// Tool 1: task_router.analyze
// Analyzes source code or plan and returns a complexity score + tier recommendation.

server.setRequestHandler(
  z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.literal('task_router.analyze'),
      arguments: AnalysisTargetSchema,
    }),
  }),
  async (request) => {
    try {
      const target = request.params.arguments;
      const result = await analyzer.analyze(target);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
            _meta: {
              outputSchema: ComplexityScoreSchema,
            },
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: `Analysis failed: ${message}` }],
      };
    }
  },
);

// Tool 2: task_router.decompose
// Accepts an architectural plan and returns decomposed subtasks with routing.

server.setRequestHandler(
  z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.literal('task_router.decompose'),
      arguments: z.object({
        plan: z.string().describe('Architectural plan or description text to decompose'),
        parentId: z.string().optional().describe('Optional parent task ID'),
        thresholdOverrides: ThresholdOverridesSchema.optional().describe('Threshold overrides'),
      }),
    }),
  }),
  async (request) => {
    try {
      const { plan, parentId, thresholdOverrides } = request.params.arguments;

      const localDecomposer = thresholdOverrides
        ? new Decomposer({ thresholdOverrides })
        : decomposer;

      const result = await localDecomposer.decompose(plan, parentId);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                summary: result.summary,
                subtaskCount: result.subtasks.length,
                subtasks: result.subtasks.map(t => ({
                  id: t.id,
                  title: t.title,
                  complexity: t.complexity?.total ?? null,
                  tier: t.tier,
                  tierLabel: t.tier !== undefined
                    ? (['', 'Junior', 'Mid', 'Senior', 'Expert'])[t.tier]
                    : null,
                })),
              },
              null,
              2,
            ),
            _meta: {
              outputSchema: z.object({
                summary: z.string(),
                subtaskCount: z.number(),
                subtasks: z.array(z.object({
                  id: z.string(),
                  title: z.string(),
                  complexity: z.number().nullable(),
                  tier: z.number().nullable(),
                  tierLabel: z.string().nullable(),
                })),
              }),
            },
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: `Decomposition failed: ${message}` }],
      };
    }
  },
);

// Tool 3: task_router.estimate_effort
// Quick effort estimation — takes a complexity score or analysis target,
// returns tier info, recommended models, and effort guidance.

server.setRequestHandler(
  z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.literal('task_router.estimate_effort'),
      arguments: z.object({
        score: z.number().optional().describe('Known complexity score (0-100)'),
        target: AnalysisTargetSchema.optional().describe('Analyze a target to get a score first'),
        thresholdOverrides: ThresholdOverridesSchema.optional().describe('Threshold overrides'),
      }),
    }),
  }),
  async (request) => {
    try {
      const { score: providedScore, target, thresholdOverrides } = request.params.arguments;

      let score: number;

      if (providedScore !== undefined) {
        score = providedScore;
      } else if (target) {
        const localAnalyzer = thresholdOverrides
          ? new Analyzer({ thresholdOverrides })
          : analyzer;
        const result = await localAnalyzer.analyze(target);
        score = result.total;
      } else {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: 'Either "score" or "target" must be provided.',
          }],
        };
      }

      const localTable = thresholdOverrides
        ? new RoutingTable(thresholdOverrides)
        : routingTable;

      const tierDef = localTable.getTierDefinition(score);
      const tierNames = ['', 'Junior', 'Mid', 'Senior', 'Expert'];
      const tierLabel = tierNames[tierDef.tier] ?? 'Unknown';

      const result = {
        score,
        tier: tierDef.tier,
        tierLabel,
        recommendedModels: tierDef.recommendedModels,
        guidance: tierDef.guidance,
        effortEstimate: estimateEffort(score, tierLabel),
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: `Estimation failed: ${message}` }],
      };
    }
  },
);

/**
 * Heuristic effort estimation based on score and tier.
 */
function estimateEffort(
  score: number,
  tierLabel: string,
): { level: string; description: string; suggestedTimeframe: string } {
  if (score <= 15) {
    return {
      level: 'trivial',
      description: 'Quick task — one or two prompts, minimal review needed.',
      suggestedTimeframe: 'minutes',
    };
  }
  if (score <= 40) {
    return {
      level: 'moderate',
      description: 'Several iterations, moderate review. Likely a few files.',
      suggestedTimeframe: 'under an hour',
    };
  }
  if (score <= 80) {
    return {
      level: 'complex',
      description: 'Substantial work across multiple files/modules. Needs thorough review.',
      suggestedTimeframe: 'a few hours to a day',
    };
  }
  return {
    level: 'expert',
    description: 'Major undertaking. May require deep architectural decisions and extensive review.',
    suggestedTimeframe: 'multiple days',
  };
}

// Tool 4: task_router.estimate
// Heuristic task complexity estimation — accepts a free-form task description
// and returns complexity level, recommended model, estimated cost/tokens.

server.setRequestHandler(
  z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.literal('task_router.estimate'),
      arguments: z.object({
        description: z.string().describe('Task description to estimate'),
        includeSubtasks: z.boolean().optional().describe('Whether to attempt subtask extraction'),
      }),
    }),
  }),
  async (request) => {
    try {
      const { description, includeSubtasks } = request.params.arguments;

      const estimate = estimateComplexity(description);

      if (includeSubtasks) {
        const subtasks = extractSubtasks(description);
        if (subtasks.length > 0) {
          estimate.subtasks = subtasks;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(estimate, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: `Estimation failed: ${message}` }],
      };
    }
  },
);

// Tool 5: task_router.route
// Full complexity-based routing — accepts source code or description,
// runs the metric pipeline with configurable algorithm (weighted|strict),
// and returns tier, model recommendations, metric breakdown, and effort estimate.

server.setRequestHandler(
  z.object({
    method: z.literal('tools/call'),
    params: z.object({
      name: z.literal('task_router.route'),
      arguments: z.object({
        code: z.string().optional().describe('Source code to analyze via metrics'),
        description: z.string().optional().describe('Task description for heuristic fallback routing'),
        language: z.string().optional().describe('Programming language hint (e.g. typescript, python)'),
        algorithm: z.enum(['weighted', 'strict']).optional().describe('Routing algorithm: weighted (default) or strict (max-of-core-metrics)'),
        configPath: z.string().optional().describe('Path to router config JSON file'),
        configOverrides: z.object({
          algorithm: z.enum(['weighted', 'strict']).optional(),
          metricWeights: z.record(z.string(), z.number()).optional(),
          thresholds: z.object({
            tier1Max: z.number().optional(),
            tier2Max: z.number().optional(),
            tier3Max: z.number().optional(),
          }).optional(),
        }).optional().describe('Inline config overrides'),
      }),
    }),
  }),
  async (request) => {
    try {
      const { code, description, language, algorithm, configPath, configOverrides } = request.params.arguments;

      if (!code && !description) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Either "code" (for metric-based analysis) or "description" (for heuristic routing) must be provided.' }],
        };
      }

      // Build config overrides that match RouterConfig shape
      const mergedOverrides: Partial<RouterConfig> = {};
      if (algorithm) mergedOverrides.algorithm = algorithm;
      if (configOverrides?.metricWeights) mergedOverrides.metricWeights = configOverrides.metricWeights;
      if (configOverrides?.thresholds) mergedOverrides.thresholds = configOverrides.thresholds;

      const decision = await ComplexityClassifier.route({
        code,
        description,
        language,
        configPath,
        configOverrides: Object.keys(mergedOverrides).length > 0 ? mergedOverrides : undefined,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(decision, null, 2),
        }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: 'text', text: `Routing failed: ${message}` }],
      };
    }
  },
);

// ---- Startup ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Notify on stderr so as not to pollute stdout (which is the MCP transport)
  console.error(`[${PACKAGE_NAME}] MCP server started (v${PACKAGE_VERSION})`);
  console.error(`[${PACKAGE_NAME}] Tools: task_router.analyze, task_router.decompose, task_router.estimate_effort, task_router.estimate, task_router.route`);
}

main().catch((error) => {
  console.error(`[${PACKAGE_NAME}] Fatal error:`, error);
  process.exit(1);
});

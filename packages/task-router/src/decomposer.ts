import {
  Task,
  RoutingTier,
  ThresholdOverrides,
} from './types.js';
import { RoutingTable } from './routing-table.js';
import { Analyzer } from './analyzer.js';

export interface DecomposeResult {
  /** The parent task */
  parent: Task;
  /** List of decomposed sub-tasks */
  subtasks: Task[];
  /** Summary of the decomposition */
  summary: string;
}

export interface DecomposerOptions {
  /** Threshold overrides for routing */
  thresholdOverrides?: ThresholdOverrides;
}

/**
 * Plan decomposer: takes architectural plan text, splits into micro-tasks
 * with estimated complexity, and can auto-route each subtask.
 */
export class Decomposer {
  private analyzer: Analyzer;

  constructor(options?: DecomposerOptions) {
    this.analyzer = new Analyzer(options);
  }

  /**
   * Decompose an architectural plan into micro-tasks.
   *
   * Parses the plan text looking for markdown headings, numbered lists,
   * or bullet-pointed items to identify individual work units.
   * Each identified unit becomes a Task with an estimated complexity score.
   */
  async decompose(
    planText: string,
    parentId?: string,
  ): Promise<DecomposeResult> {
    const lines = planText.split('\n');
    const rawBlocks = this.extractPlanBlocks(lines);

    const subtasks: Task[] = [];
    for (let i = 0; i < rawBlocks.length; i++) {
      const block = rawBlocks[i];
      const id = parentId ? `${parentId}-sub-${i + 1}` : `sub-${i + 1}`;

      // Estimate complexity from the block text
      const complexity = await this.analyzer.analyze({
        type: 'plan',
        plan: block.text,
      });

      subtasks.push({
        id,
        title: block.title || `Sub-task ${i + 1}`,
        description: block.text,
        complexity,
        tier: complexity.tier,
      });
    }

    // If we couldn't extract blocks, treat the whole plan as one task
    if (subtasks.length === 0) {
      const complexity = await this.analyzer.analyze({
        type: 'plan',
        plan: planText,
      });

      subtasks.push({
        id: parentId ? `${parentId}-sub-1` : 'sub-1',
        title: 'Analysis Task',
        description: planText,
        complexity,
        tier: complexity.tier,
      });
    }

    const parent: Task = {
      id: parentId ?? 'plan-root',
      title: 'Decomposed Plan',
      description: planText,
      subtasks,
    };

    const summary = this.buildSummary(subtasks);

    return { parent, subtasks, summary };
  }

  /**
   * Parse plan text into structured blocks based on markdown headings,
   * numbered lists, and bullet points.
   */
  private extractPlanBlocks(
    lines: string[],
  ): { title: string; text: string }[] {
    const blocks: { title: string; text: string }[] = [];
    let currentTitle = '';
    let currentLines: string[] = [];

    function flush() {
      if (currentLines.length > 0) {
        blocks.push({
          title: currentTitle,
          text: currentLines.join('\n').trim(),
        });
        currentLines = [];
      }
    }

    for (const line of lines) {
      const headingMatch = line.match(/^#{1,6}\s+(.+)/);
      const numberedMatch = line.match(/^\d+[.)]\s+(.+)/);
      const bulletMatch = line.match(/^[*-]\s+(.+)/);

      if (headingMatch) {
        flush();
        currentTitle = headingMatch[1].trim();
      } else if (numberedMatch || bulletMatch) {
        // If we have accumulated content without a heading title,
        // start a new block on each major list item
        if (currentLines.length > 0 && !currentTitle) {
          flush();
        }
        currentLines.push(line);
        if (!currentTitle) {
          currentTitle = (numberedMatch?.[1] ?? bulletMatch?.[1] ?? '').trim();
        }
      } else if (line.trim()) {
        currentLines.push(line);
      }
    }

    flush();
    return blocks;
  }

  /**
   * Assign routing tiers to each subtask based on a common routing table.
   */
  routeSubtasks(subtasks: Task[], overrides?: ThresholdOverrides): Task[] {
    const table = new RoutingTable(overrides);
    return subtasks.map(task => {
      const score = task.complexity?.total ?? 0;
      return {
        ...task,
        tier: table.getTier(score),
      };
    });
  }

  private buildSummary(subtasks: Task[]): string {
    const tierCounts: Record<string, number> = {};
    for (const t of subtasks) {
      const label = t.tier ? RoutingTier[t.tier] : 'unassigned';
      tierCounts[label] = (tierCounts[label] ?? 0) + 1;
    }

    const tierBreakdown = Object.entries(tierCounts)
      .map(([tier, count]) => `${count} × ${tier}`)
      .join(', ');

    const avgScore =
      subtasks.length > 0
        ? subtasks.reduce((s, t) => s + (t.complexity?.total ?? 0), 0) /
          subtasks.length
        : 0;

    return (
      `Decomposed into ${subtasks.length} sub-tasks. ` +
      `Tier breakdown: ${tierBreakdown}. ` +
      `Average complexity: ${avgScore.toFixed(1)}/100.`
    );
  }
}

import type { Finding, ScanReport } from './types.js';
import type { PatternSeverityType } from '@hermes/shared/schemas/patterns.js';

/**
 * Severity scoring weights for aggregating scan results.
 */
export const SEVERITY_WEIGHTS: Record<PatternSeverityType, number> = {
  critical: 10,
  error: 5,
  warning: 2,
  info: 1,
};

/**
 * Compute an overall severity score for a set of findings.
 * Scores are weighted sums normalized by finding count.
 */
export function scoreSeverity(findings: Finding[]): number {
  if (findings.length === 0) return 0;
  let total = 0;
  for (const f of findings) {
    total += SEVERITY_WEIGHTS[f.severity] || 1;
  }
  return Math.round((total / findings.length) * 10) / 10;
}

/**
 * Generate a human-readable markdown report from a ScanReport.
 */
export function generateMarkdownReport(report: ScanReport): string {
  const lines: string[] = [];
  const score = scoreSeverity(report.findings);

  lines.push(`# Pattern Miner Scan Report`);
  lines.push(``);
  lines.push(`**Scan ID:** ${report.scanId}`);
  lines.push(`**Timestamp:** ${report.timestamp}`);
  lines.push(`**Duration:** ${report.durationMs}ms`);
  lines.push(`**Files Scanned:** ${report.filesScanned}`);
  lines.push(`**Total Findings:** ${report.totalFindings}`);
  lines.push(`**Severity Score:** ${score}/10`);
  lines.push(``);

  // Summary by severity
  lines.push(`## Summary by Severity`);
  lines.push(``);
  lines.push(`| Severity | Count |`);
  lines.push(`|----------|-------|`);
  for (const sev of ['critical', 'error', 'warning', 'info'] as PatternSeverityType[]) {
    const count = report.findingsBySeverity[sev] || 0;
    lines.push(`| ${sev} | ${count} |`);
  }
  lines.push(``);

  // Summary by category
  const findingsByCategory: Record<string, number> = {};
  for (const f of report.findings) {
    const cat = f.category || 'unknown';
    findingsByCategory[cat] = (findingsByCategory[cat] || 0) + 1;
  }
  lines.push(`## Summary by Category`);
  lines.push(``);
  lines.push(`| Category | Count |`);
  lines.push(`|----------|-------|`);
  for (const [cat, count] of Object.entries(findingsByCategory).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${cat} | ${count} |`);
  }
  lines.push(``);

  // Detailed findings
  lines.push(`## Findings`);
  lines.push(``);

  if (report.findings.length === 0) {
    lines.push(`*No findings detected.*`);
    lines.push(``);
  } else {
    // Sort by severity (critical first), then by file path
    const sorted = [...report.findings].sort((a, b) => {
      const order: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3 };
      const aOrder = order[a.severity] ?? 4;
      const bOrder = order[b.severity] ?? 4;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.filePath.localeCompare(b.filePath) || a.line - b.line;
    });

    for (const f of sorted) {
      const severityTag = `**\`[${f.severity.toUpperCase()}]\`**`;
      const location = f.filePath ? `\`${f.filePath}:${f.line}\`` : `line ${f.line}`;
      lines.push(`- ${severityTag} ${location} — ${f.message}`);
      if (f.snippet) {
        lines.push(`  \`\`\``);
        lines.push(`  ${f.snippet.replace(/`/g, '\\`')}`);
        lines.push(`  \`\`\``);
      }
      lines.push(``);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a JSON report from a ScanReport.
 */
export function generateJsonReport(report: ScanReport): string {
  const score = scoreSeverity(report.findings);

  const jsonReport = {
    scanId: report.scanId,
    timestamp: report.timestamp,
    durationMs: report.durationMs,
    filesScanned: report.filesScanned,
    totalFindings: report.totalFindings,
    severityScore: score,
    findingsBySeverity: report.findingsBySeverity,
    findings: report.findings.map(f => ({
      patternId: f.patternId,
      patternName: f.patternName,
      filePath: f.filePath,
      line: f.line,
      column: f.column,
      endLine: f.endLine,
      message: f.message,
      severity: f.severity,
      category: f.category,
      snippet: f.snippet,
    })),
  };

  return JSON.stringify(jsonReport, null, 2);
}

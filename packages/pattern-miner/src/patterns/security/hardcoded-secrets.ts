import type { PatternMatchType, PatternSeverityType, PatternCategoryType } from '@hermes/shared/schemas/patterns.js';

/**
 * Detect hardcoded secrets — API keys, passwords, tokens, and other credentials
 * hardcoded in source files.
 */
export async function detectHardcodedSecrets(
  files: { path: string; content: string }[],
): Promise<PatternMatchType[]> {
  const findings: PatternMatchType[] = [];

  // Regex patterns for various types of secrets
  const secretPatterns: { regex: RegExp; label: string; severity: PatternSeverityType }[] = [
    // AWS keys
    { regex: /(?:AKIA[0-9A-Z]{16})/g, label: 'AWS Access Key ID', severity: 'critical' },
    { regex: /(?:['"](?:SK|aws_secret_access_key|secret_key|secret_access_key|aws_secret)\s*['"]?\s*[:=]\s*['"]?)([A-Za-z0-9\/+=]{40})(?:['"]\s*[,;)]?)/g, label: 'AWS Secret Access Key', severity: 'critical' },

    // API keys (generic)
    { regex: /(?:['"](?:api[-_]?key|apikey|api_key|api[-_]?secret|api_secret)\s*['"]?\s*[:=]\s*['"]?)([a-zA-Z0-9_\-]{20,})(?:['"]\s*[,;)]?)/g, label: 'API Key', severity: 'critical' },

    // JWT tokens
    { regex: /(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, label: 'JWT Token', severity: 'critical' },

    // GitHub tokens
    { regex: /(?:ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|ghr_[A-Za-z0-9]{36})/g, label: 'GitHub Token', severity: 'critical' },

    // Generic password assignments
    { regex: /(?:['"](?:password|passwd|pwd|secret|token|auth[-_]?token|access[-_]?token)\s*['"]?\s*[:=]\s*['"]?)([^'"{}\s,;)]{8,})(?:['"]\s*[,;)]?)/g, label: 'Hardcoded Credential', severity: 'critical' },

    // Slack tokens
    { regex: /(?:xox[abpors]-[A-Za-z0-9-]{10,})/g, label: 'Slack Token', severity: 'critical' },

    // Private keys
    { regex: /(?:-----BEGIN\s+(?:RSA|DSA|EC|PGP|OPENSSH)\s+PRIVATE\s+KEY-----)/g, label: 'Private Key', severity: 'critical' },

    // MongoDB connection strings
    { regex: /(?:mongodb(?:\+srv)?:\/\/[^@:\s]+:[^@\s]+@)/g, label: 'MongoDB Connection String', severity: 'critical' },

    // PostgreSQL connection strings
    { regex: /(?:postgres(?:\+ssl)?:\/\/[^@:\s]+:[^@\s]+@)/g, label: 'PostgreSQL Connection String', severity: 'critical' },

    // Redis connection strings
    { regex: /(?:redis:\/\/[^@:\s]+:[^@\s]+@)/g, label: 'Redis Connection String', severity: 'critical' },

    // MySQL connection strings
    { regex: /(?:mysql:\/\/[^@:\s]+:[^@\s]+@)/g, label: 'MySQL Connection String', severity: 'critical' },

    // Generic connection strings with password
    { regex: /(?:['"]?(?:database_url|database[-_]?url|db_url|connection[-_]?string|conn_string)\s*['"]?\s*[:=]\s*['"]?)[a-zA-Z0-9+._:\/@%-]+:[^@\s]+@/g, label: 'Connection String with Password', severity: 'critical' },
  ];

  // Files that might contain test fixtures or example data
  const testFilePattern = /(?:test|spec|fixture|mock|example|sample|\.test\.|\.spec\.)/i;

  for (const file of files) {
    // Skip node_modules, .git, dist, .env files (typically expected)
    if (file.path.includes('node_modules') || file.path.includes('.git') || file.path.includes('/dist/')) continue;

    // Skip files in test directories if they contain example/fake values
    const isTestFile = testFilePattern.test(file.path);
    const lines = file.content.split('\n');

    for (const { regex, label, severity } of secretPatterns) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(file.content)) !== null) {
        const lineNum = file.content.substring(0, match.index).split('\n').length - 1;
        const lineText = lines[lineNum]?.trim() || '';

        // Skip comment lines in test files
        if (isTestFile && (lineText.startsWith('//') || lineText.startsWith('#') || lineText.startsWith('/*'))) continue;

        const snippet = lineText.substring(0, 80);
        const value = match[1] || match[0];

        // Skip obviously fake/test values
        if (value.includes('xxxx') || value.includes('YOUR_') || value.includes('your-') || value.includes('placeholder') || value.includes('EXAMPLE')) continue;

        // Skip values that look like JS expressions or object references
        if (/process\.env\./.test(snippet) || /\.env\./.test(snippet)) continue;

        // Skip environment variable references
        if (/process\.env|Deno\.env|import\.meta\.env/.test(snippet)) continue;

        findings.push({
          pattern_id: 'hardcoded-secrets',
          pattern_name: 'Hardcoded Secret',
          file_path: file.path,
          line: lineNum + 1,
          column: match.index,
          message: `Hardcoded ${label} detected — store in environment variables or a vault`,
          severity,
          category: 'security' as PatternCategoryType,
          snippet,
        });
      }
    }
  }

  return findings;
}

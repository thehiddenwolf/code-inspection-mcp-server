#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { checkSingleResponsibility } from './rules/single-responsibility.js';
import { checkOpenClosed } from './rules/open-closed.js';
import { checkLiskovSubstitution } from './rules/liskov.js';
import { checkInterfaceSegregation } from './rules/interface-segregation.js';
import { checkDependencyInversion } from './rules/dependency-inversion.js';
import type { ViolationType } from '@hermes/shared/schemas/violations.js';

// Define CLI ANSI colors
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';

function getFilesRecursively(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      if (
        file !== 'node_modules' &&
        file !== 'dist' &&
        file !== '.git' &&
        file !== '.hermes' &&
        file !== 'coverage'
      ) {
        getFilesRecursively(filePath, fileList);
      }
    } else {
      if (/\.(ts|js)x?$/.test(file) && !file.endsWith('.d.ts') && !file.endsWith('.test.ts') && !file.endsWith('.spec.ts')) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

function runChecksOnCode(code: string, filePath: string): ViolationType[] {
  const violations: ViolationType[] = [];
  violations.push(...checkSingleResponsibility(code, filePath));
  violations.push(...checkOpenClosed(code, filePath));
  violations.push(...checkLiskovSubstitution(code, filePath));
  violations.push(...checkInterfaceSegregation(code, filePath));
  violations.push(...checkDependencyInversion(code, filePath));
  return violations;
}

function getChangedFiles(baseBranch: string): string[] {
  try {
    const stdout = execSync(`git diff --name-only ${baseBranch}...`, { encoding: 'utf-8' });
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(file => path.resolve(process.cwd(), file));
  } catch (err) {
    console.error(`${YELLOW}Warning: Failed to run git diff against ${baseBranch}. Defaulting to all files.${RESET}`);
    return [];
  }
}

function getBaseBranchFileContent(baseBranch: string, relativePath: string): string | null {
  try {
    // Relative path for git show needs to use forward slashes
    const gitPath = relativePath.replace(/\\/g, '/');
    return execSync(`git show ${baseBranch}:${gitPath}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (err) {
    // File did not exist in base branch
    return null;
  }
}

function main() {
  const args = process.argv.slice(2);

  // Check for --compare-branch flag
  let compareBranch: string | null = null;
  const compareIndex = args.indexOf('--compare-branch');
  if (compareIndex !== -1 && compareIndex + 1 < args.length) {
    compareBranch = args[compareIndex + 1];
    args.splice(compareIndex, 2);
  }

  let targets: string[] = [];

  // Load configuration
  let config: { rules?: Record<string, string>; exclude?: string[] } = {};
  const configPaths = [
    path.join(process.cwd(), 'solid-enforcer.config.json'),
    path.join(process.cwd(), 'packages/solid-enforcer/solid-enforcer.config.json')
  ];
  for (const cp of configPaths) {
    if (fs.existsSync(cp)) {
      try {
        config = JSON.parse(fs.readFileSync(cp, 'utf-8'));
        break;
      } catch (e) {
        console.error(`${YELLOW}Warning: Failed to parse config file at ${cp}${RESET}`);
      }
    }
  }

  if (compareBranch) {
    console.log(`${BLUE}Running in CI diff-mode against base branch: ${compareBranch}${RESET}`);
    const changedFiles = getChangedFiles(compareBranch);
    targets = changedFiles.filter(file => {
      return /\.(ts|js)x?$/.test(file) && !file.endsWith('.d.ts') && !file.endsWith('.test.ts') && !file.endsWith('.spec.ts');
    });
  } else if (args.length > 0) {
    for (const arg of args) {
      const fullPath = path.resolve(arg);
      if (!fs.existsSync(fullPath)) {
        console.error(`${RED}Error: Path does not exist: ${arg}${RESET}`);
        process.exit(1);
      }
      if (fs.statSync(fullPath).isDirectory()) {
        getFilesRecursively(fullPath, targets);
      } else {
        targets.push(fullPath);
      }
    }
  } else {
    // Default: scan packages/ directory in monorepo
    const rootDir = process.cwd();
    const packagesDir = path.join(rootDir, 'packages');
    if (fs.existsSync(packagesDir)) {
      getFilesRecursively(packagesDir, targets);
    } else {
      getFilesRecursively(rootDir, targets);
    }
  }

  // Filter excluded targets from config
  if (config.exclude && config.exclude.length > 0) {
    targets = targets.filter(file => {
      const relPath = path.relative(process.cwd(), file);
      const parts = relPath.split(path.sep);
      return !config.exclude!.some(excludePattern => {
        return parts.includes(excludePattern) || relPath.includes(excludePattern);
      });
    });
  }

  console.log(`${BOLD}${CYAN}=== SOLID Enforcer: Auditing Codebase ===${RESET}`);
  console.log(`Found ${targets.length} target files to scan.\n`);

  let totalViolations = 0;
  const fileReports: { file: string; violations: ViolationType[] }[] = [];

  for (const file of targets) {
    const code = fs.readFileSync(file, 'utf-8');
    const currentViolations = runChecksOnCode(code, file);

    if (currentViolations.length === 0) continue;

    let finalViolations = currentViolations;

    // In diff-mode, filter out existing baseline violations
    if (compareBranch) {
      const relativePath = path.relative(process.cwd(), file);
      const baseContent = getBaseBranchFileContent(compareBranch, relativePath);
      if (baseContent !== null) {
        const baseViolations = runChecksOnCode(baseContent, file);
        // A violation is new if its rule_id and message do not match any base violation
        finalViolations = currentViolations.filter(cv => {
          return !baseViolations.some(bv => bv.rule_id === cv.rule_id && bv.message === cv.message);
        });
      }
    }

    if (finalViolations.length > 0) {
      fileReports.push({ file, violations: finalViolations });
      totalViolations += finalViolations.length;
    }
  }

  if (totalViolations === 0) {
    console.log(`${GREEN}✔ All files passed SOLID compliance audits!${RESET}`);
    process.exit(0);
  }

  for (const report of fileReports) {
    const relativePath = path.relative(process.cwd(), report.file);
    console.log(`${BOLD}${YELLOW}⚠ ${relativePath}${RESET} (${report.violations.length} new violation(s))`);
    for (const v of report.violations) {
      // Apply severity overrides from config
      if (config.rules && config.rules[v.category]) {
        v.severity = config.rules[v.category] as 'error' | 'info' | 'warning' | 'critical';
      }
      const severityColor = v.severity === 'critical' || v.severity === 'error' ? RED : YELLOW;
      console.log(
        `  - [${severityColor}${v.severity.toUpperCase()}${RESET}] ${BOLD}${v.rule_name}${RESET} (Line ${v.locations[0]?.line})`
      );
      console.log(`    ${v.message}`);
      if (v.remediation) {
        console.log(`    ${CYAN}Remediation: ${v.remediation}${RESET}`);
      }
      console.log();
    }
  }

  console.log(`${BOLD}${RED}SOLID Check Failed: Found ${totalViolations} new violations across ${fileReports.length} files.${RESET}`);
  process.exit(1);
}

main();

/**
 * CLI smoke tests — @hermes/cli
 *
 * Tests the code-inspection-mcp CLI commands via subprocess execution.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

const CLI_PATH = resolve(__dirname, '../dist/index.js');

function runCli(args: string): { stdout: string; stderr: string } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return { stdout: stdout.trim(), stderr: '' };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (error.stdout ?? '').trim(),
      stderr: (error.stderr ?? '').trim(),
    };
  }
}

describe('code-inspection-mcp CLI', () => {
  it('should output version with --version', () => {
    const { stdout } = runCli('--version');
    expect(stdout).toMatch(/0\.1\.0/);
  });

  it('should list tools with list command', () => {
    const { stdout } = runCli('list');
    expect(() => JSON.parse(stdout)).not.toThrow();
    const tools = JSON.parse(stdout);
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).toHaveProperty('name');
    expect(tools[0]).toHaveProperty('description');
    expect(tools[0]).toHaveProperty('inputSchema');
  });

  it('should include token_squeezer.squeeze in list', () => {
    const { stdout } = runCli('list');
    const tools = JSON.parse(stdout);
    const squeeze = tools.find((t: { name: string }) => t.name === 'token_squeezer.squeeze');
    expect(squeeze).toBeDefined();
    expect(squeeze.description).toContain('Reduce code context');
  });

  it('should show help with help command', () => {
    const { stdout } = runCli('help');
    expect(stdout).toContain('code-inspection-mcp');
    expect(stdout).toContain('start');
    expect(stdout).toContain('list');
    expect(stdout).toContain('run');
    expect(stdout).toContain('scan');
    expect(stdout).toContain('analyze');
    expect(stdout).toContain('audit');
  });

  it('should show help with --help', () => {
    const { stdout } = runCli('--help');
    expect(stdout).toContain('code-inspection-mcp');
    expect(stdout).toContain('start');
    expect(stdout).toContain('list');
  });

  it('should run a tool and return its output', () => {
    const { stdout } = runCli('run token_squeezer.squeeze \'{"code":"const x = 1;","language":"typescript"}\'');
    expect(stdout).toContain('const x = 1;');
  });

  it('should run a tool with JSON output format options', () => {
    const { stdout } = runCli('run token_squeezer.squeeze \'{"code":"const x = 1;","language":"typescript","options":{"output_format":"json"}}\'');
    expect(() => JSON.parse(stdout)).not.toThrow();
    const result = JSON.parse(stdout);
    expect(result.original).toBe('const x = 1;');
    expect(result.squeezed).toBe('const x = 1;');
  });

  it('should return error for unknown tool', () => {
    const { stdout, stderr } = runCli('run nonexistent.tool');
    expect(stderr).toContain('Unknown tool');
  });

  it('should handle error for invalid JSON args', () => {
    const { stdout, stderr } = runCli('run token_squeezer.squeeze not-json');
    expect(stderr).toContain('Invalid JSON arguments');
  });
});

/**
 * @hermes/solid-enforcer — unit tests
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkSingleResponsibility } from '../src/rules/single-responsibility.js';
import { checkOpenClosed } from '../src/rules/open-closed.js';
import { checkLiskovSubstitution } from '../src/rules/liskov.js';
import { checkInterfaceSegregation } from '../src/rules/interface-segregation.js';
import { checkDependencyInversion } from '../src/rules/dependency-inversion.js';
import { ALL_PRINCIPLES } from '../src/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf-8');
}

describe('SOLIDEnforcer', () => {
  // ── SRP ─────────────────────────────────────────────────────
  describe('Single Responsibility Principle', () => {
    it('detects SRP violations in a class with mixed concerns', () => {
      const code = readFixture('srp-violation.ts');
      const violations = checkSingleResponsibility(code, 'srp-violation.ts');

      expect(violations.length).toBeGreaterThanOrEqual(1);

      const srpViolation = violations[0];
      expect(srpViolation.rule_id).toBe('solid_srp');
      expect(srpViolation.severity).toBe('warning');
      expect(srpViolation.message).toContain('UserManager');
      expect(srpViolation.message).toContain('multiple concerns');
      expect(srpViolation.category).toBe('solid_srp');
      expect(srpViolation.locations).toHaveLength(1);
      expect(srpViolation.locations[0].file).toBe('srp-violation.ts');
    });

    it('returns no violations for clean code', () => {
      const code = readFixture('clean-code.ts');
      const violations = checkSingleResponsibility(code, 'clean-code.ts');
      expect(violations).toHaveLength(0);
    });
  });

  // ── OCP ─────────────────────────────────────────────────────
  describe('Open/Closed Principle', () => {
    it('detects OCP violations from large switch statements', () => {
      const code = readFixture('ocp-violation.ts');
      const violations = checkOpenClosed(code, 'ocp-violation.ts');

      expect(violations.length).toBeGreaterThanOrEqual(1);

      const ocpViolations = violations.filter(v => v.rule_id === 'solid_ocp');
      expect(ocpViolations.length).toBeGreaterThanOrEqual(1);
      expect(ocpViolations[0].message).toContain('Switch');
      expect(ocpViolations[0].category).toBe('solid_ocp');
    });

    it('returns no violations for strategy-pattern-based code', () => {
      const code = readFixture('clean-code.ts');
      const violations = checkOpenClosed(code, 'clean-code.ts');
      // Clean code uses strategy pattern, should have 0 OCP violations
      const ocpViolations = violations.filter(v => v.rule_id === 'solid_ocp');
      expect(ocpViolations).toHaveLength(0);
    });
  });

  // ── LSP ─────────────────────────────────────────────────────
  describe('Liskov Substitution Principle', () => {
    it('detects LSP violations from NotImplementedError throws', () => {
      const code = readFixture('lsp-violation.ts');
      const violations = checkLiskovSubstitution(code, 'lsp-violation.ts');

      expect(violations.length).toBeGreaterThanOrEqual(1);

      const lspViolations = violations.filter(v => v.rule_id === 'solid_lsp');
      expect(lspViolations.length).toBeGreaterThanOrEqual(1);

      // Should flag the NotImplementedError throws
      const notImplViolations = lspViolations.filter(v =>
        v.message.includes('NotImplementedError')
      );
      expect(notImplViolations.length).toBeGreaterThanOrEqual(1);

      // Should also flag the generic Error('not implemented') throw
      const notImplGeneric = lspViolations.filter(v =>
        v.message.includes('Error')
      );
      expect(notImplGeneric.length).toBeGreaterThanOrEqual(1);
    });

    it('returns no violations for clean hierarchy', () => {
      const code = readFixture('clean-code.ts');
      const violations = checkLiskovSubstitution(code, 'clean-code.ts');
      const lspViolations = violations.filter(v => v.rule_id === 'solid_lsp');
      expect(lspViolations).toHaveLength(0);
    });
  });

  // ── ISP ─────────────────────────────────────────────────────
  describe('Interface Segregation Principle', () => {
    it('detects ISP violations from fat interfaces', () => {
      const code = readFixture('isp-violation.ts');
      const violations = checkInterfaceSegregation(code, 'isp-violation.ts');

      expect(violations.length).toBeGreaterThanOrEqual(1);

      const ispViolations = violations.filter(v => v.rule_id === 'solid_isp');
      expect(ispViolations.length).toBeGreaterThanOrEqual(1);

      // Should flag the MediaPlayer interface with 10 methods
      const fatInterfaceViolation = ispViolations.find(v =>
        v.message.includes('MediaPlayer')
      );
      expect(fatInterfaceViolation).toBeDefined();
      expect(fatInterfaceViolation!.severity).toBe('warning');
      expect(fatInterfaceViolation!.message).toContain('10 methods');

      // Should flag the partial implementation (NotImplementedError throws)
      const partialImplViolation = ispViolations.find(v =>
        v.message.includes('BasicAudioPlayer')
      );
      expect(partialImplViolation).toBeDefined();
      expect(partialImplViolation!.severity).toBe('error');
    });

    it('returns no violations for small interfaces', () => {
      const code = readFixture('clean-code.ts');
      const violations = checkInterfaceSegregation(code, 'clean-code.ts');
      const ispViolations = violations.filter(v => v.rule_id === 'solid_isp');
      expect(ispViolations).toHaveLength(0);
    });
  });

  // ── DIP ─────────────────────────────────────────────────────
  describe('Dependency Inversion Principle', () => {
    it('detects DIP violations from direct concrete instantiation', () => {
      const code = readFixture('dip-violation.ts');
      const violations = checkDependencyInversion(code, 'dip-violation.ts');

      const dipViolations = violations.filter(v => v.rule_id === 'solid_dip');
      expect(dipViolations.length).toBeGreaterThanOrEqual(1);

      // Should flag OrderService's direct instantiation
      const orderServiceViolations = dipViolations.filter(v =>
        v.message.includes('OrderService')
      );
      expect(orderServiceViolations.length).toBeGreaterThanOrEqual(1);

      // Should flag `new MySqlDatabase()`
      const mysqlViolation = orderServiceViolations.find(v =>
        v.message.includes('MySqlDatabase')
      );
      expect(mysqlViolation).toBeDefined();

      // Should flag `new EmailService()`
      const emailViolation = orderServiceViolations.find(v =>
        v.message.includes('EmailService')
      );
      expect(emailViolation).toBeDefined();
    });

    it('detects static method calls on concrete classes', () => {
      const code = readFixture('dip-violation.ts');
      const violations = checkDependencyInversion(code, 'dip-violation.ts');

      const staticCallViolations = violations.filter(v =>
        v.message.includes('MetricsCollector')
      );
      expect(staticCallViolations.length).toBeGreaterThanOrEqual(1);
    });

    it('returns no violations for properly injected dependencies', () => {
      const code = readFixture('clean-code.ts');
      const violations = checkDependencyInversion(code, 'clean-code.ts');
      const dipViolations = violations.filter(v => v.rule_id === 'solid_dip');
      expect(dipViolations).toHaveLength(0);
    });
  });

  // ── Single principle check ─────────────────────────────────
  describe('Single principle check', () => {
    it('can check a single principle independently', () => {
      const srpCode = readFixture('srp-violation.ts');
      const ocpCode = readFixture('ocp-violation.ts');

      // Check SRP only on OCP fixture — should have 0 SRP violations
      const ocpCodeSrpViolations = checkSingleResponsibility(ocpCode, 'ocp-violation.ts');
      expect(ocpCodeSrpViolations).toHaveLength(0);

      // Check SRP on SRP fixture — should have violations
      const srpViolations = checkSingleResponsibility(srpCode, 'srp-violation.ts');
      expect(srpViolations.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Clean code check ────────────────────────────────────────
  describe('Clean code', () => {
    it('returns no violations for clean code across all principles', () => {
      const code = readFixture('clean-code.ts');
      const file = 'clean-code.ts';

      const allViolations = [
        ...checkSingleResponsibility(code, file),
        ...checkOpenClosed(code, file),
        ...checkLiskovSubstitution(code, file),
        ...checkInterfaceSegregation(code, file),
        ...checkDependencyInversion(code, file),
      ];

      expect(allViolations).toHaveLength(0);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fixFile } from '../src/fixer.js';

describe('Lint Fixer', () => {
  const testFile = path.resolve('./packages/lint-fixer/test/fixture_test.js');

  beforeEach(() => {
    // Write a JS file with some cleanable/formattable code
    fs.writeFileSync(testFile, 'const a = 1; \n\nconst b = 2;\n', 'utf8');
  });

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should run fixFile in dryRun mode and not alter the original file', async () => {
    const res = await fixFile(testFile, true);
    
    // In dryRun, original file should remain unchanged
    const originalOnDisk = fs.readFileSync(testFile, 'utf8');
    expect(originalOnDisk).toBe('const a = 1; \n\nconst b = 2;\n');
    
    // Verify results structure
    expect(res.filePath).toBe(testFile);
    expect(res.originalContent).toBe('const a = 1; \n\nconst b = 2;\n');
    expect(typeof res.fixed).toBe('boolean');
    expect(typeof res.fixedContent).toBe('string');
  });

  it('should run fixFile and modify the original file when dryRun is false', async () => {
    const res = await fixFile(testFile, false);
    
    // Check that results return correctly
    expect(res.filePath).toBe(testFile);
    expect(res.originalContent).toBe('const a = 1; \n\nconst b = 2;\n');
    
    // If a fixer executed (like prettier or eslint), file might have changed
    if (res.fixed) {
      const diskContent = fs.readFileSync(testFile, 'utf8');
      expect(diskContent).toBe(res.fixedContent);
      expect(res.diff).toContain('const a');
    }
  });

  it('should throw an error for non-existent files', async () => {
    await expect(fixFile('non-existent-file-path.js')).rejects.toThrow('File not found');
  });

  it('should return fixed: false and error message for unsupported file extensions', async () => {
    const txtFile = path.resolve('./packages/lint-fixer/test/fixture_test.txt');
    fs.writeFileSync(txtFile, 'Hello world', 'utf8');
    
    try {
      const res = await fixFile(txtFile, false);
      expect(res.fixed).toBe(false);
      expect(res.error).toContain('Unsupported file extension');
    } finally {
      if (fs.existsSync(txtFile)) {
        fs.unlinkSync(txtFile);
      }
    }
  });
});

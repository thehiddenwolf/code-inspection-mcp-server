import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger, type LanguagePack, LanguagePackRegistry } from '@hermes/shared';


const log = createLogger('lint-fixer');

export interface FixResult {
  filePath: string;
  fixed: boolean;
  originalContent: string;
  fixedContent: string;
  diff: string;
  commandsRun: string[];
  error?: string;
}



function runCommand(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string; notFound: boolean }> {
  return new Promise((resolve) => {
    // We use shell: true to resolve npx and other commands properly on Linux
    const proc = spawn(cmd, args, { shell: true, cwd });
    let stdout = '';
    let stderr = '';
    let notFound = false;

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      if (msg.includes('not found') || msg.includes('command not found') || msg.includes('ENOENT')) {
        notFound = true;
      }
    });

    proc.on('error', (err: Error & { code?: string }) => {
      if (err.code === 'ENOENT') {
        resolve({ code: 127, stdout, stderr, notFound: true });
      } else {
        resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message, notFound: false });
      }
    });

    proc.on('close', (code) => {
      const finalCode = code ?? 0;
      // Code 127 is standard for command not found in bash/sh
      const isNotFound = notFound || finalCode === 127;
      resolve({ code: finalCode, stdout, stderr, notFound: isNotFound });
    });
  });
}

function runDiff(originalPath: string, fixedPath: string): Promise<string> {
  return new Promise((resolve) => {
    const diffProc = spawn('diff', ['-u', originalPath, fixedPath]);
    let stdout = '';
    diffProc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    diffProc.on('close', () => {
      resolve(stdout);
    });
  });
}

export async function fixFile(filePath: string, dryRun: boolean = false): Promise<FixResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const absolutePath = path.resolve(filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const originalContent = fs.readFileSync(absolutePath, 'utf8');

  // Try resolving lint/fix commands from the language pack registry first
  const registry = LanguagePackRegistry.getInstance();
  const pack = registry.getLanguagePackByFileExtension(ext);
  const candidates = pack?.lintFix?.commands;

  if (!candidates || candidates.length === 0) {
    return {
      filePath: absolutePath,
      fixed: false,
      originalContent,
      fixedContent: originalContent,
      diff: '',
      commandsRun: [],
      error: `Unsupported file extension for lint fixing: ${ext}`
    };
  }

  // Create temporary file in the same directory to resolve configs correctly
  const dirName = path.dirname(absolutePath);
  const baseName = path.basename(absolutePath, ext);
  const tempPath = path.join(dirName, `${baseName}.lint-fix-temp${ext}`);

  try {
    fs.writeFileSync(tempPath, originalContent, 'utf8');
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      filePath: absolutePath,
      fixed: false,
      originalContent,
      fixedContent: originalContent,
      diff: '',
      commandsRun: [],
      error: `Failed to create temporary file: ${errMsg}`
    };
  }

  const commandsRun: string[] = [];
  let fileChanged = false;

  for (const candidate of candidates) {
    const [bin, ...args] = candidate;
    
    // For dotnet format --include or others, we want to specify the file
    // By default, we append the temp file path as the last argument
    const finalArgs = [...args, tempPath];
    const fullCmdStr = `${bin} ${finalArgs.join(' ')}`;

    log.info(`Trying lint fixer: ${fullCmdStr}`);
    try {
      const res = await runCommand(bin, finalArgs, dirName);
      if (res.notFound) {
        log.debug(`Linter command not found, skipping: ${bin}`);
        continue;
      }

      commandsRun.push(fullCmdStr);
      
      // Read current temp file content to see if it changed
      const currentTempContent = fs.readFileSync(tempPath, 'utf8');
      if (currentTempContent !== originalContent) {
        fileChanged = true;
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn(`Error running linter candidate ${bin}`, { err: errMsg });
    }
  }

  const fixedContent = fs.readFileSync(tempPath, 'utf8');
  let diff = '';

  if (fileChanged) {
    diff = await runDiff(absolutePath, tempPath);
  }

  // Clean up temp file
  try {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to delete temporary file: ${tempPath}`, { err: errMsg });
  }

  if (fileChanged && !dryRun) {
    try {
      fs.writeFileSync(absolutePath, fixedContent, 'utf8');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        filePath: absolutePath,
        fixed: false,
        originalContent,
        fixedContent: originalContent,
        diff: '',
        commandsRun,
        error: `Failed to write fixed content back to file: ${errMsg}`
      };
    }
  }

  return {
    filePath: absolutePath,
    fixed: fileChanged,
    originalContent,
    fixedContent,
    diff,
    commandsRun
  };
}

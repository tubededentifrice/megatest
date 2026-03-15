import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function getCommitHash(repoPath: string): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function getBranchName(repoPath: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export function ensureGitignore(megatestDir: string): void {
  const gitignorePath = path.join(megatestDir, '.gitignore');
  const requiredEntries = ['reports/', 'actuals/'];

  if (!fs.existsSync(gitignorePath)) {
    const content = `# Megatest generated files\n${requiredEntries.join('\n')}\n`;
    fs.writeFileSync(gitignorePath, content);
    return;
  }

  const existing = fs.readFileSync(gitignorePath, 'utf-8');
  const missing = requiredEntries.filter(entry => !existing.split('\n').some(line => line.trim() === entry));
  if (missing.length > 0) {
    const suffix = (existing.endsWith('\n') ? '' : '\n') + missing.join('\n') + '\n';
    fs.appendFileSync(gitignorePath, suffix);
  }
}

export function resolveMegatestDir(repoPath: string): string {
  return path.resolve(repoPath, '.megatest');
}

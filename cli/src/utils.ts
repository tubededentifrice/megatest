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
  const content = `# Megatest generated files
reports/
actuals/
`;
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, content);
  }
}

export function resolveMegatestDir(repoPath: string): string {
  return path.resolve(repoPath, '.megatest');
}

import * as vscode from 'vscode';
import { execFile, ExecFileException } from 'child_process';
import * as path from 'path';

export interface FileAddedLines {
  filePath: string;
  addedLineNumbers: Set<number>;
}

/**
 * Executes a git command safely in a given working directory.
 */
function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

/**
 * Determines the primary base branch (configured, or detected main/master).
 */
export async function getBaseBranch(cwd: string, preferredBase: string = 'main'): Promise<string> {
  try {
    const branchesOutput = await execGit(['branch', '--list', preferredBase, 'master', 'main'], cwd);
    const branches = branchesOutput
      .split('\n')
      .map((b) => b.trim().replace(/^\*\s*/, ''))
      .filter(Boolean);

    if (branches.includes(preferredBase)) {
      return preferredBase;
    }
    if (branches.includes('main')) {
      return 'main';
    }
    if (branches.includes('master')) {
      return 'master';
    }
  } catch {
    // If branch lookup fails, fallback to preferredBase
  }
  return preferredBase;
}

/**
 * Parses unified diff output to extract added line numbers (0-indexed) per file.
 *
 * @param diffOutput The output of `git diff -U0 ...`
 * @param repoRoot Root path of the repository
 */
export function parseDiffAddedLines(diffOutput: string, repoRoot: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  const lines = diffOutput.split('\n');

  let currentFile: string | null = null;

  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      const relPath = line.substring(6).trim();
      currentFile = path.resolve(repoRoot, relPath);
      if (!result.has(currentFile)) {
        result.set(currentFile, new Set<number>());
      }
    } else if (line.startsWith('@@ ') && currentFile !== null) {
      // Format: @@ -oldStart[,oldCount] +newStart[,newCount] @@
      const match = line.match(/@@\s+-[0-9]+(?:,[0-9]+)?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@/);
      if (match) {
        const startLine = parseInt(match[1], 10);
        const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        const lineSet = result.get(currentFile);

        if (lineSet) {
          // Unified diff line numbers are 1-based, convert to 0-based for VS Code
          for (let i = 0; i < count; i++) {
            lineSet.add(startLine + i - 1);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Obtains the map of newly added lines (0-indexed) in the working tree/branch.
 * Cascades gracefully from baseBranch -> HEAD -> unstaged/staged working tree changes.
 */
export async function getBranchAddedLines(
  repoRoot: string,
  baseBranch: string
): Promise<Map<string, Set<number>>> {
  try {
    const targetBase = await getBaseBranch(repoRoot, baseBranch);
    let diff = '';

    // 1. Try diff against base branch
    try {
      diff = await execGit(['diff', '-U0', targetBase], repoRoot);
    } catch {
      // 2. Try diff against HEAD
      try {
        diff = await execGit(['diff', '-U0', 'HEAD'], repoRoot);
      } catch {
        // 3. Fallback: unstaged working tree diff against git index
        try {
          diff = await execGit(['diff', '-U0'], repoRoot);
        } catch {
          diff = '';
        }
      }
    }

    const resultMap = parseDiffAddedLines(diff, repoRoot);

    // Also check staged changes if diff was only unstaged
    try {
      const cachedDiff = await execGit(['diff', '--cached', '-U0'], repoRoot);
      const cachedMap = parseDiffAddedLines(cachedDiff, repoRoot);
      for (const [file, lines] of cachedMap.entries()) {
        if (!resultMap.has(file)) {
          resultMap.set(file, new Set<number>());
        }
        for (const l of lines) {
          resultMap.get(file)!.add(l);
        }
      }
    } catch {
      // Ignore if cached diff fails
    }

    return resultMap;
  } catch (error) {
    // If not a git repo or git fails, return empty map
    return new Map();
  }
}

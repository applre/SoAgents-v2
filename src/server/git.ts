import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';

// ============= TYPES =============

export interface GitStatusFile {
  path: string;
  status: 'new' | 'modified' | 'deleted';
}

export interface GitStatusResult {
  files: GitStatusFile[];
  gitInitialized?: boolean;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  date: string;
  author: string;
  numFiles: number;
}

export interface GitLogResult {
  entries: GitLogEntry[];
  gitInitialized?: boolean;
}

export interface GitSubmitResult {
  success: boolean;
  hash?: string;
  error?: string;
}

export interface GitInitResult {
  initialized: boolean;
}

export interface GitRevertResult {
  success: boolean;
  error?: string;
}

// ============= HELPERS =============

const DEFAULT_GITIGNORE = `node_modules
.env
*.log
__pycache__
.DS_Store
dist
build
`;

/**
 * Run a git command in the given directory.
 * Returns stdout string, or throws on error.
 */
function runGit(args: string[], cwd: string): string {
  return execSync(['git', ...args].join(' '), {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Check if the given directory has a .git folder (i.e. is a git repo root or child).
 */
function isGitRepo(workspacePath: string): boolean {
  try {
    runGit(['rev-parse', '--git-dir'], workspacePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Map a porcelain status code to our status type.
 * Porcelain v1: two chars XY. We check index (X) and worktree (Y).
 */
function mapPorcelainCode(xy: string): GitStatusFile['status'] | null {
  const x = xy[0] ?? ' ';
  const y = xy[1] ?? ' ';

  // Untracked
  if (x === '?' && y === '?') return 'new';

  // Deleted (from either index or worktree)
  if (x === 'D' || y === 'D') return 'deleted';

  // Added to index is also "new" from user perspective
  if (x === 'A') return 'new';

  // Any other modification
  if (x !== ' ' || y !== ' ') return 'modified';

  return null;
}

// ============= API HANDLERS =============

/**
 * GET /api/git/status
 * Returns list of changed files in the workspace.
 */
export function handleGitStatus(workspacePath: string): GitStatusResult {
  if (!isGitRepo(workspacePath)) {
    return { files: [], gitInitialized: false };
  }

  try {
    const output = runGit(['status', '--porcelain'], workspacePath);
    const files: GitStatusFile[] = [];

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;

      const xy = line.substring(0, 2);
      const filePath = line.substring(3).trim();

      // Handle rename: "R old -> new" — porcelain shows "R  old\0new" but in v1 text it's "R  old -> new"
      // We show the new path for renames
      const displayPath = filePath.includes(' -> ')
        ? filePath.split(' -> ')[1]!.trim()
        : filePath;

      const status = mapPorcelainCode(xy);
      if (status && displayPath) {
        files.push({ path: displayPath, status });
      }
    }

    return { files };
  } catch (error) {
    console.error('[git] status error:', error);
    return { files: [], gitInitialized: false };
  }
}

/**
 * GET /api/git/log
 * Returns recent git log entries with file counts.
 */
export function handleGitLog(workspacePath: string): GitLogResult {
  if (!isGitRepo(workspacePath)) {
    return { entries: [], gitInitialized: false };
  }

  try {
    // Get log in a parseable pipe-delimited format
    const logOutput = runGit(
      ['log', '--format=%H|%s|%ai|%an', '-n', '30'],
      workspacePath
    );

    const entries: GitLogEntry[] = [];

    for (const line of logOutput.split('\n')) {
      if (!line.trim()) continue;

      const parts = line.split('|');
      if (parts.length < 4) continue;

      const hash = parts[0]!.trim();
      // Message may itself contain '|', so join remaining parts after first 3 splits
      const message = parts.slice(1, parts.length - 2).join('|').trim();
      const date = parts[parts.length - 2]!.trim();
      const author = parts[parts.length - 1]!.trim();

      // Count changed files for this commit
      let numFiles = 0;
      try {
        const diffOutput = runGit(
          ['diff-tree', '--no-commit-id', '-r', '--name-only', hash],
          workspacePath
        );
        numFiles = diffOutput.split('\n').filter(l => l.trim()).length;
      } catch {
        // If diff-tree fails (e.g. root commit), leave 0
      }

      entries.push({ hash, message, date, author, numFiles });
    }

    return { entries };
  } catch (error) {
    console.error('[git] log error:', error);
    return { entries: [], gitInitialized: false };
  }
}

/**
 * POST /api/git/submit
 * Stage all changes and commit with the given message.
 */
export function handleGitSubmit(workspacePath: string, message?: string): GitSubmitResult {
  const commitMessage = message?.trim() || 'Checkpoint';

  try {
    runGit(['add', '-A'], workspacePath);
    runGit(['commit', '-m', JSON.stringify(commitMessage)], workspacePath);

    // Get the hash of the new commit
    const hash = runGit(['rev-parse', 'HEAD'], workspacePath).trim();
    console.log(`[git] committed: ${hash} "${commitMessage}"`);

    return { success: true, hash };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    // "nothing to commit" is not an error worth surfacing as failure
    if (errMsg.includes('nothing to commit')) {
      return { success: false, error: 'Nothing to commit — workspace is clean.' };
    }
    console.error('[git] submit error:', error);
    return { success: false, error: errMsg };
  }
}

/**
 * POST /api/git/init  (also callable from startup auto-init)
 * Initialize a git repo, write a .gitignore, and set local user config.
 */
export function handleGitInit(workspacePath: string): GitInitResult {
  try {
    runGit(['init'], workspacePath);

    // Write a default .gitignore if one doesn't exist
    const gitignorePath = join(workspacePath, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, DEFAULT_GITIGNORE, 'utf-8');
      console.log('[git] wrote default .gitignore');
    }

    // Set local user config if not already set
    try {
      runGit(['config', '--local', 'user.email', 'myagents@local'], workspacePath);
    } catch {
      // May fail if config already set globally — non-fatal
    }
    try {
      runGit(['config', '--local', 'user.name', 'MyAgents'], workspacePath);
    } catch {
      // Non-fatal
    }

    console.log(`[git] initialized repo at ${workspacePath}`);
    return { initialized: true };
  } catch (error) {
    console.error('[git] init error:', error);
    throw error;
  }
}

/**
 * POST /api/git/revert
 * Revert a single file or all changes in the workspace.
 * - filePath provided: revert that specific file (checkout tracked, clean untracked)
 * - filePath omitted:  revert all changes (checkout -- . && git clean -fd)
 */
export function handleGitRevert(workspacePath: string, filePath?: string): GitRevertResult {
  if (!isGitRepo(workspacePath)) {
    return { success: false, error: 'Not a git repository' };
  }

  try {
    if (filePath) {
      // Determine whether the file is tracked or untracked
      const statusOutput = runGit(['status', '--porcelain', '--', filePath], workspacePath);
      const xy = statusOutput.trim().substring(0, 2);
      const isUntracked = xy === '??';

      if (isUntracked) {
        // Untracked (new) file — delete it with git clean
        runGit(['clean', '-fd', '--', filePath], workspacePath);
      } else {
        // Tracked file (modified/deleted) — restore to HEAD
        runGit(['checkout', 'HEAD', '--', filePath], workspacePath);
      }
      console.log(`[git] reverted file: ${filePath}`);
    } else {
      // Revert all: restore tracked files, remove untracked
      runGit(['checkout', 'HEAD', '--', '.'], workspacePath);
      runGit(['clean', '-fd'], workspacePath);
      console.log('[git] reverted all changes');
    }
    return { success: true };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[git] revert error:', error);
    return { success: false, error: errMsg };
  }
}

/**
 * Auto-initialize git for a workspace if it is not a temp path and has no .git directory.
 * Called from server startup.
 */
export function autoInitGitRepo(workspacePath: string): void {
  // Skip temp/system directories
  const isTempPath =
    workspacePath.startsWith('/tmp') ||
    workspacePath.startsWith('/var/folders') ||
    workspacePath.toLowerCase().includes('\\temp\\') ||
    workspacePath.toLowerCase().includes('\\tmp\\');

  if (isTempPath) {
    console.log('[git] skipping auto-init for temp path:', workspacePath);
    return;
  }

  // Skip if already a git repo
  if (existsSync(join(workspacePath, '.git'))) {
    return;
  }

  try {
    handleGitInit(workspacePath);
    console.log('[git] auto-initialized git repo at startup');
  } catch (error) {
    // Non-fatal — workspace is usable without git
    console.warn('[git] auto-init failed (non-fatal):', error instanceof Error ? error.message : error);
  }
}

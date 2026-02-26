/**
 * WorkspaceChangesPanel - Git-backed workspace change history panel
 *
 * Shows:
 * - Pending (unstaged/staged) file changes with status badges
 * - A description input + Submit button to create a checkpoint commit
 * - Commit history log with relative timestamps
 * - An Initialize button when the workspace has no git repo yet
 */
import { GitBranch, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useTabApi } from '@/context/TabContext';
import { useToast } from '@/components/Toast';

// ─── Types (mirrors server/git.ts) ───────────────────────────────────────────

interface PendingFile {
    path: string;
    status: 'new' | 'modified' | 'deleted';
}

interface HistoryEntry {
    hash: string;
    message: string;
    date: string;
    numFiles: number;
}

interface GitStatusResponse {
    files: PendingFile[];
    gitInitialized?: boolean;
}

interface GitLogResponse {
    entries: HistoryEntry[];
    gitInitialized?: boolean;
}

interface GitSubmitResponse {
    success: boolean;
    hash?: string;
    error?: string;
}

interface GitInitResponse {
    initialized: boolean;
}

interface GitRevertResponse {
    success: boolean;
    error?: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface WorkspaceChangesPanelProps {
    agentDir: string;
    /** Increment this from the parent to trigger a refresh (e.g. on turn:complete) */
    refreshTrigger?: number;
    /** Called whenever the pending file count changes, for badge display */
    onPendingCountChange?: (count: number) => void;
    /** Called after a revert or submit so the Files tab can refresh its tree */
    onFilesChanged?: () => void;
}

// Maps file status to a human-readable verb used in toast messages
const REVERT_VERB: Record<PendingFile['status'], string> = {
    deleted: 'Restored',
    modified: 'Discarded',
    new: 'Removed',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) return 'just now';
    if (diffHr < 1) return `${diffMin} min ago`;
    if (diffDay < 1) return `${diffHr}h ago`;
    return `${diffDay}d ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WorkspaceChangesPanel({
    agentDir,
    refreshTrigger = 0,
    onPendingCountChange,
    onFilesChanged,
}: WorkspaceChangesPanelProps) {
    const { apiGet, apiPost } = useTabApi();
    const toast = useToast();
    const toastRef = useRef(toast);
    toastRef.current = toast;
    const onPendingCountChangeRef = useRef(onPendingCountChange);
    onPendingCountChangeRef.current = onPendingCountChange;
    const onFilesChangedRef = useRef(onFilesChanged);
    onFilesChangedRef.current = onFilesChanged;

    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isReverting, setIsReverting] = useState(false);
    const [revertingFile, setRevertingFile] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [gitInitialized, setGitInitialized] = useState(true);

    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => { isMountedRef.current = false; };
    }, []);

    // ── Data fetching ──────────────────────────────────────────────────────────

    const fetchStatus = useCallback(async () => {
        try {
            const res = await apiGet<GitStatusResponse>('/api/git/status');
            if (!isMountedRef.current) return;
            // gitInitialized is undefined (true) when the repo exists; false when not
            setGitInitialized(res.gitInitialized !== false);
            const files = res.files ?? [];
            setPendingFiles(files);
            onPendingCountChangeRef.current?.(files.length);
        } catch (err) {
            if (!isMountedRef.current) return;
            console.error('[WorkspaceChangesPanel] status fetch failed:', err);
        }
    }, [apiGet]);

    const fetchLog = useCallback(async () => {
        try {
            const res = await apiGet<GitLogResponse>('/api/git/log');
            if (!isMountedRef.current) return;
            setHistory(res.entries ?? []);
        } catch (err) {
            if (!isMountedRef.current) return;
            console.error('[WorkspaceChangesPanel] log fetch failed:', err);
        }
    }, [apiGet]);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        await Promise.all([fetchStatus(), fetchLog()]);
        if (isMountedRef.current) setIsLoading(false);
    }, [fetchStatus, fetchLog]);

    useEffect(() => {
        void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshTrigger]);  // refresh is stable (useCallback with stable deps), but we intentionally only re-run on refreshTrigger change

    // ── Actions ────────────────────────────────────────────────────────────────

    const handleSubmit = useCallback(async () => {
        setIsSubmitting(true);
        try {
            const res = await apiPost<GitSubmitResponse>('/api/git/submit', {
                message: description.trim() || 'Checkpoint',
                workspacePath: agentDir,
            });
            if (!isMountedRef.current) return;
            if (res.success) {
                setDescription('');
                toastRef.current.success('Checkpoint saved');
                onFilesChangedRef.current?.();
                await Promise.all([fetchStatus(), fetchLog()]);
            } else {
                toastRef.current.error(res.error ?? 'Submit failed');
            }
        } catch (err) {
            if (!isMountedRef.current) return;
            console.error('[WorkspaceChangesPanel] submit failed:', err);
            toastRef.current.error('Submit failed, please retry');
        } finally {
            if (isMountedRef.current) setIsSubmitting(false);
        }
    }, [apiPost, agentDir, description, fetchStatus, fetchLog]);

    const handleInit = useCallback(async () => {
        try {
            await apiPost<GitInitResponse>('/api/git/init', { workspacePath: agentDir });
            if (!isMountedRef.current) return;
            toastRef.current.success('Version control initialized');
            await refresh();
        } catch (err) {
            if (!isMountedRef.current) return;
            console.error('[WorkspaceChangesPanel] init failed:', err);
            toastRef.current.error('Initialization failed, please retry');
        }
    }, [apiPost, agentDir, refresh]);

    const handleRevertFile = useCallback(async (filePath: string, fileStatus: PendingFile['status']) => {
        setRevertingFile(filePath);
        try {
            const res = await apiPost<GitRevertResponse>('/api/git/revert', {
                workspacePath: agentDir,
                filePath,
            });
            if (!isMountedRef.current) return;
            if (res.success) {
                toastRef.current.success(`${REVERT_VERB[fileStatus]}: ${filePath}`);
                onFilesChangedRef.current?.();
                await fetchStatus();
            } else {
                toastRef.current.error(res.error ?? 'Revert failed');
            }
        } catch (err) {
            if (!isMountedRef.current) return;
            console.error('[WorkspaceChangesPanel] revert file failed:', err);
            toastRef.current.error('Revert failed, please retry');
        } finally {
            if (isMountedRef.current) setRevertingFile(null);
        }
    }, [apiPost, agentDir, fetchStatus]);

    const handleRevertAll = useCallback(async () => {
        setIsReverting(true);
        try {
            const res = await apiPost<GitRevertResponse>('/api/git/revert', {
                workspacePath: agentDir,
            });
            if (!isMountedRef.current) return;
            if (res.success) {
                toastRef.current.success('All changes reverted');
                onFilesChangedRef.current?.();
                await fetchStatus();
            } else {
                toastRef.current.error(res.error ?? 'Revert failed');
            }
        } catch (err) {
            if (!isMountedRef.current) return;
            console.error('[WorkspaceChangesPanel] revert all failed:', err);
            toastRef.current.error('Revert failed, please retry');
        } finally {
            if (isMountedRef.current) setIsReverting(false);
        }
    }, [apiPost, agentDir, fetchStatus]);

    // ── Render ─────────────────────────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 px-3 py-4 text-base text-[var(--ink-muted)]">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Loading...</span>
            </div>
        );
    }

    if (!gitInitialized) {
        return (
            <div className="px-3 py-4">
                <div className="mb-3 flex items-center gap-2 text-base text-[var(--ink-muted)]">
                    <GitBranch className="h-5 w-5 shrink-0" />
                    <span>VCS not initialized</span>
                </div>
                <p className="mb-3 text-sm text-[var(--ink-faint)]">
                    Initialize version control to track workspace changes and create checkpoints.
                </p>
                <button
                    onClick={handleInit}
                    className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 active:opacity-80"
                >
                    Initialize
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 px-3 py-3">
            {/* ── Pending Changes ── */}
            <section>
                <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                        Pending Works
                        {pendingFiles.length > 0 && (
                            <span className="ml-1.5 rounded-full bg-[var(--paper-contrast)] px-1.5 py-0.5 text-xs font-normal">
                                {pendingFiles.length}
                            </span>
                        )}
                    </h3>
                    <div className="flex items-center gap-1">
                        {pendingFiles.length > 0 && (
                            <button
                                onClick={handleRevertAll}
                                disabled={isReverting}
                                title="Revert all changes"
                                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/20"
                            >
                                {isReverting
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <RotateCcw className="h-3.5 w-3.5" />
                                }
                                <span>Revert All</span>
                            </button>
                        )}
                        <button
                            onClick={refresh}
                            title="Refresh"
                            className="rounded p-1 text-[var(--ink-faint)] hover:text-[var(--ink-muted)]"
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>

                {pendingFiles.length === 0 ? (
                    <p className="text-sm text-[var(--ink-faint)]">All caught up ✓</p>
                ) : (
                    <>
                        <ul className="mb-3 space-y-1.5">
                            {pendingFiles.map((file) => (
                                <PendingFileRow
                                    key={file.path}
                                    file={file}
                                    isReverting={revertingFile === file.path}
                                    onRevert={(path) => handleRevertFile(path, file.status)}
                                />
                            ))}
                        </ul>

                        {/* Submit form */}
                        <div className="flex flex-col gap-2">
                            <input
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !isSubmitting) void handleSubmit();
                                }}
                                placeholder="Description (optional)"
                                className="w-full rounded-md border border-[var(--line)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink-faint)] focus:border-[var(--accent)] focus:outline-none"
                            />
                            <button
                                onClick={handleSubmit}
                                disabled={isSubmitting}
                                className="flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                Submit
                            </button>
                        </div>
                    </>
                )}
            </section>

            {/* Divider */}
            <div className="border-t border-[var(--line)]" />

            {/* ── History ── */}
            <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                    History
                </h3>

                {history.length === 0 ? (
                    <p className="text-sm text-[var(--ink-faint)]">No history yet</p>
                ) : (
                    <ul className="space-y-2">
                        {history.map((entry) => (
                            <HistoryEntryRow key={entry.hash} entry={entry} />
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PendingFileRow({
    file,
    isReverting,
    onRevert,
}: {
    file: PendingFile;
    isReverting: boolean;
    onRevert: (path: string) => void;
}) {
    const { prefix, colorClass } = STATUS_META[file.status];
    return (
        <li className="flex items-center gap-2 text-sm">
            <span className={`shrink-0 font-mono font-semibold ${colorClass}`}>{prefix}</span>
            <span className="min-w-0 truncate text-[var(--ink)]" title={file.path}>
                {file.path}
            </span>
            <span className={`shrink-0 text-xs ${colorClass}`}>
                {STATUS_LABELS[file.status]}
            </span>
            <button
                onClick={() => onRevert(file.path)}
                disabled={isReverting}
                title={file.status === 'deleted' ? `Restore ${file.path}` : `Discard changes to ${file.path}`}
                className="ml-1 shrink-0 rounded p-0.5 text-[var(--ink-faint)] hover:text-red-500 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {isReverting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RotateCcw className="h-3.5 w-3.5" />
                }
            </button>
        </li>
    );
}

function HistoryEntryRow({ entry }: { entry: HistoryEntry }) {
    return (
        <li className="flex items-start gap-2 text-sm text-[var(--ink-muted)]">
            <span className="mt-0.5 shrink-0 text-[var(--ink-faint)]">●</span>
            <span className="shrink-0 tabular-nums text-[var(--ink-faint)]">
                {formatRelativeTime(entry.date)}
            </span>
            <span className="min-w-0 truncate" title={entry.message}>
                &ldquo;{entry.message}&rdquo;
            </span>
            <span className="ml-auto shrink-0 text-[var(--ink-faint)]">
                {entry.numFiles} {entry.numFiles === 1 ? 'file' : 'files'}
            </span>
        </li>
    );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<PendingFile['status'], { prefix: string; colorClass: string }> = {
    new: { prefix: '+', colorClass: 'text-green-600' },
    modified: { prefix: '~', colorClass: 'text-yellow-600' },
    deleted: { prefix: '✕', colorClass: 'text-red-600' },
};

const STATUS_LABELS: Record<PendingFile['status'], string> = {
    new: 'New',
    modified: 'Modified',
    deleted: 'Deleted',
};

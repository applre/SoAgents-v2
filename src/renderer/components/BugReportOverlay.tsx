import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

import { CUSTOM_EVENTS } from '../../shared/constants';
import { isTauriEnvironment } from '@/utils/browserMock';

interface GhCliStatus {
    available: boolean;
    authenticated: boolean;
    version: string | null;
}

interface BugReportOverlayProps {
    onClose: () => void;
    appVersion: string;
}

type SubmitMode = 'github' | 'anonymous';

export default function BugReportOverlay({ onClose, appVersion }: BugReportOverlayProps) {
    const [description, setDescription] = useState('');
    const [submitMode, setSubmitMode] = useState<SubmitMode>('github');
    const isTauri = isTauriEnvironment();
    const [ghStatus, setGhStatus] = useState<GhCliStatus | null>(
        isTauri ? null : { available: false, authenticated: false, version: null }
    );
    const [checking, setChecking] = useState(isTauri);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Check gh CLI status on mount (Tauri only)
    useEffect(() => {
        if (!isTauri) return;
        invoke<GhCliStatus>('cmd_check_gh_cli')
            .then(setGhStatus)
            .catch(() => setGhStatus({ available: false, authenticated: false, version: null }))
            .finally(() => setChecking(false));
    }, [isTauri]);

    // Focus textarea on mount
    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    // Escape to close
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const handleSubmit = useCallback(() => {
        if (!description.trim()) return;
        window.dispatchEvent(new CustomEvent(CUSTOM_EVENTS.LAUNCH_BUG_REPORT, {
            detail: { description: description.trim(), submitMode, appVersion },
        }));
        onClose();
    }, [description, submitMode, appVersion, onClose]);

    const canSubmit = description.trim().length > 0;

    // gh status display
    const renderGhStatus = () => {
        if (checking) {
            return <span className="flex items-center gap-1 text-[var(--ink-muted)]"><Loader2 className="h-3 w-3 animate-spin" />检测中...</span>;
        }
        if (!ghStatus?.available) {
            return <span className="text-[var(--error)]">✕ 未安装 gh CLI</span>;
        }
        if (!ghStatus.authenticated) {
            return <span className="text-[var(--warning)]">⚠ gh 未认证（请先运行 gh auth login）</span>;
        }
        return <span className="text-[var(--success)]">✓ 已安装且已认证</span>;
    };

    return (
        <div
            className="fixed inset-0 z-[250] flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm"
            onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="glass-panel w-full max-w-md">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
                    <h2 className="text-[14px] font-semibold text-[var(--ink)]">报告问题</h2>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1 text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-contrast)] hover:text-[var(--ink)]"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="space-y-4 px-5 py-4">
                    {/* Description */}
                    <div>
                        <label className="mb-1.5 block text-[13px] font-medium text-[var(--ink)]">
                            请描述你遇到的问题
                        </label>
                        <textarea
                            ref={textareaRef}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="详细描述问题的表现、触发步骤等..."
                            className="w-full resize-none rounded-lg border border-[var(--line)] bg-[var(--paper-inset)] px-3 py-2.5 text-[13px] text-[var(--ink)] placeholder:text-[var(--ink-muted)]/50 focus:border-[var(--accent)] focus:outline-none"
                            rows={5}
                        />
                    </div>

                    {/* Submit Mode */}
                    <div>
                        <label className="mb-2 block text-[13px] font-medium text-[var(--ink)]">
                            提交方式
                        </label>
                        <div className="space-y-2">
                            {/* GitHub Issue option */}
                            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--line)] p-3 transition-colors hover:bg-[var(--paper-contrast)]">
                                <input
                                    type="radio"
                                    name="submitMode"
                                    value="github"
                                    checked={submitMode === 'github'}
                                    onChange={() => setSubmitMode('github')}
                                    className="mt-0.5 accent-[var(--accent)]"
                                />
                                <div className="flex-1">
                                    <div className="text-[13px] font-medium text-[var(--ink)]">
                                        GitHub Issue
                                        <span className="ml-1.5 text-[11px] font-normal text-[var(--ink-muted)]">（需安装 gh CLI）</span>
                                    </div>
                                    <div className="mt-1 text-[11px]">
                                        {renderGhStatus()}
                                    </div>
                                </div>
                            </label>

                            {/* Anonymous option (P2) */}
                            <label className="flex cursor-not-allowed items-start gap-2.5 rounded-lg border border-[var(--line)] p-3 opacity-50">
                                <input
                                    type="radio"
                                    name="submitMode"
                                    value="anonymous"
                                    disabled
                                    className="mt-0.5"
                                />
                                <div className="flex-1">
                                    <div className="text-[13px] font-medium text-[var(--ink-muted)]">
                                        匿名提交
                                        <span className="ml-1.5 text-[11px] font-normal">（即将支持）</span>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 border-t border-[var(--line)] px-5 py-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full bg-[var(--button-secondary-bg)] px-4 py-1.5 text-[12px] font-semibold text-[var(--button-secondary-text)] transition-colors hover:bg-[var(--button-secondary-bg-hover)]"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="rounded-full bg-[var(--button-primary-bg)] px-4 py-1.5 text-[12px] font-semibold text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)] disabled:opacity-50"
                    >
                        AI 分析并上报
                    </button>
                </div>
            </div>
        </div>
    );
}

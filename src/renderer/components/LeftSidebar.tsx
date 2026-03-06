import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart2, Clock, MoreHorizontal, PanelLeft, Pencil, Pin, Plus, RefreshCw, Trash2 } from 'lucide-react';
import appIcon from '../../../icon.png';
import { startWindowDrag, toggleMaximize } from '../utils/env';
import type { SessionMetadata } from '@/api/sessionClient';
import { getWorkspaceCronTasks } from '@/api/cronTaskClient';
import type { CronTask } from '@/types/cronTask';
import { isTauriEnvironment } from '@/utils/browserMock';
import type { ImBotStatus } from '../../shared/types/im';
import { formatTokens } from '@/utils/formatTokens';
import SessionTagBadge from './SessionTagBadge';
import SessionStatsModal from './SessionStatsModal';
import SearchModal from './SearchModal';

interface Props {
  sessions: SessionMetadata[];
  activeSessionId: string | null;
  pinnedSessionIds: Set<string>;
  runningSessions?: Set<string>;
  /** The workspace agentDir — needed to fetch cron tasks and IM statuses */
  agentDir: string | null;
  onNewChat: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onTogglePin: (sessionId: string) => void;
  onOpenSettings: () => void;
  onCollapse: () => void;
  isSettingsActive?: boolean;
  updateReady?: boolean;
  updateVersion?: string | null;
  onRestartAndUpdate?: () => void;
}

export default function LeftSidebar({
  sessions,
  activeSessionId,
  pinnedSessionIds,
  runningSessions,
  agentDir,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onTogglePin,
  onOpenSettings,
  onCollapse,
  isSettingsActive = false,
  updateReady = false,
  updateVersion,
  onRestartAndUpdate,
}: Props) {
  const [showSearch, setShowSearch] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [statsSession, setStatsSession] = useState<{ id: string; title: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Cron task and IM bot data (fetched internally, like SessionHistoryDropdown)
  const [cronTasks, setCronTasks] = useState<CronTask[]>([]);
  const [imBotStatuses, setImBotStatuses] = useState<Record<string, ImBotStatus>>({});

  // Fetch cron tasks and IM bot statuses when agentDir changes
  useEffect(() => {
    if (!agentDir) return;
    let cancelled = false;

    const imStatusPromise = isTauriEnvironment()
      ? import('@tauri-apps/api/core')
          .then(({ invoke }) => invoke<Record<string, ImBotStatus>>('cmd_im_all_bots_status'))
          .catch(() => ({} as Record<string, ImBotStatus>))
      : Promise.resolve({} as Record<string, ImBotStatus>);

    Promise.allSettled([
      getWorkspaceCronTasks(agentDir),
      imStatusPromise,
    ]).then(([cronResult, imResult]) => {
      if (cancelled) return;
      if (cronResult.status === 'fulfilled') setCronTasks(cronResult.value);
      if (imResult.status === 'fulfilled') setImBotStatuses(imResult.value);
    });

    return () => { cancelled = true; };
  }, [agentDir]);

  // Map sessionId → running cron task
  const sessionCronTaskMap = useMemo(() => {
    return new Map(
      cronTasks.filter(t => t.status === 'running').map(t => [t.sessionId, t])
    );
  }, [cronTasks]);

  // Map sessionId → IM bot platform name
  const sessionImBotMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const status of Object.values(imBotStatuses)) {
      if (status.status !== 'online' && status.status !== 'connecting') continue;
      for (const activeSession of status.activeSessions) {
        const parts = activeSession.sessionKey.split(':');
        const platform = parts[1];
        map.set(activeSession.sessionId, platform.charAt(0).toUpperCase() + platform.slice(1));
      }
    }
    return map;
  }, [imBotStatuses]);

  const sessionTitle = useCallback((s: SessionMetadata) => {
    return s.title || '未命名对话';
  }, []);

  const startRename = useCallback((s: SessionMetadata) => {
    setEditingId(s.id);
    setEditingTitle(s.title || '');
    setMenuOpenId(null);
  }, []);

  const commitRename = useCallback(() => {
    if (editingId && editingTitle.trim()) {
      onRenameSession(editingId, editingTitle.trim());
    }
    setEditingId(null);
  }, [editingId, editingTitle, onRenameSession]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const aPinned = pinnedSessionIds.has(a.id);
      const bPinned = pinnedSessionIds.has(b.id);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      return 0;
    });
  }, [sessions, pinnedSessionIds]);

  const INITIAL_LIMIT = 20;
  const displaySessions = showAll ? sortedSessions : sortedSessions.slice(0, INITIAL_LIMIT);
  const hasMore = sortedSessions.length > INITIAL_LIMIT && !showAll;

  const handleDeleteClick = useCallback((sessionId: string) => {
    setMenuOpenId(null);
    setPendingDeleteId(sessionId);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (pendingDeleteId) {
      onDeleteSession(pendingDeleteId);
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, onDeleteSession]);

  const formatTime = useCallback((isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return '昨天';
    } else if (diffDays < 7) {
      return `${diffDays}天前`;
    } else {
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
  }, []);

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-[var(--surface)]"
      style={{
        width: 278,
        minWidth: 278,
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* 顶部固定区：Logo + 菜单 */}
      <div
        className="shrink-0"
        style={{ paddingTop: 10, paddingLeft: 14, paddingRight: 14 }}
        onMouseDown={startWindowDrag}
        onDoubleClick={toggleMaximize}
      >
        {/* Logo + 折叠按钮（预留macOS traffic lights 空间）*/}
        <div
          className="flex items-center justify-between"
          style={{ height: 48, paddingLeft: 4, paddingRight: 4, marginTop: 24 }}
        >
          <div className="flex items-center gap-2">
            <img src={appIcon} alt="SoAgents" className="h-6 w-6 rounded-[6px]" />
            <span className="text-[20px] font-semibold text-[var(--ink)]">SoAgents</span>
          </div>
          <button
            onClick={onCollapse}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ink-tertiary)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors"
          >
            <PanelLeft size={16} />
          </button>
        </div>

        {/* 主菜单 */}
        <div className="flex flex-col gap-1 mt-3" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button
            onClick={onNewChat}
            className="flex items-center gap-2.5 h-[38px] px-2 rounded-lg text-[14px] font-medium text-[var(--ink)] hover:bg-[var(--hover)] transition-colors text-left"
          >
            新建对话
          </button>
          <button
            onClick={() => setShowSearch(true)}
            className="flex items-center gap-2.5 h-[38px] px-2 rounded-lg text-[14px] font-medium text-[var(--ink)] hover:bg-[var(--hover)] transition-colors text-left"
          >
            搜索对话
          </button>
        </div>
      </div>

      {/* 最近对话标题（固定） */}
      {!isSettingsActive && sessions.length > 0 && (
        <div className="shrink-0 flex items-center justify-between" style={{ padding: '12px 22px 6px' }}>
          <span className="text-[14px] font-semibold text-[var(--ink-secondary)]">最近对话</span>
          <button onClick={onNewChat}>
            <Plus size={16} className="text-[var(--ink-tertiary)] hover:text-[var(--ink)] transition-colors" />
          </button>
        </div>
      )}

      {/* 可滚动区：session 列表 */}
      <div className="flex-1 overflow-y-auto min-h-0" style={{ paddingLeft: 14, paddingRight: 14 }}>
        {!isSettingsActive && sessions.length > 0 && (
          <div className="flex flex-col gap-0.5 rounded-2xl relative" style={{ background: '#F5F3F0', padding: '6px 8px' }}>
            {menuOpenId && (
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpenId(null)} />
            )}
            {displaySessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const isPinned = pinnedSessionIds.has(s.id);
              const isMenuOpen = menuOpenId === s.id;
              const isEditing = editingId === s.id;
              const isDeleting = pendingDeleteId === s.id;
              const hasCron = sessionCronTaskMap.has(s.id);
              const imPlatform = sessionImBotMap.get(s.id);
              const stats = s.stats;
              const hasStats = stats && (stats.messageCount > 0 || stats.totalInputTokens > 0);
              const totalTokens = (stats?.totalInputTokens ?? 0) + (stats?.totalOutputTokens ?? 0);

              return (
                <div key={s.id} className="group relative">
                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={commitRename}
                      className="w-full rounded-lg px-2 py-1.5 text-[14px] bg-white border border-[var(--accent)] outline-none text-[var(--ink)]"
                    />
                  ) : isDeleting ? (
                    /* 删除确认 */
                    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 bg-red-50">
                      <span className="flex-1 truncate text-[13px] text-red-600">
                        删除「{sessionTitle(s)}」？
                      </span>
                      <button
                        onClick={handleConfirmDelete}
                        className="flex h-6 items-center justify-center rounded bg-[var(--error)] px-2 text-[12px] font-medium text-white hover:bg-[var(--error)]/80 transition-colors"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => setPendingDeleteId(null)}
                        className="flex h-6 items-center justify-center rounded bg-[var(--paper-inset)] px-2 text-[12px] font-medium text-[var(--ink-muted)] hover:bg-[var(--line)] transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => onSelectSession(s.id)}
                        className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors pr-8 ${
                          isActive
                            ? 'bg-[var(--border)] text-[var(--ink)]'
                            : 'text-[var(--ink)] hover:bg-[var(--hover)]'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          {runningSessions?.has(s.id) && (
                            <span className="relative flex h-2 w-2 shrink-0">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                            </span>
                          )}
                          {isPinned && <Pin size={12} className="shrink-0 text-[var(--ink-tertiary)]" />}
                          {imPlatform && (
                            <SessionTagBadge tag={{ type: 'im', platform: imPlatform }} />
                          )}
                          {hasCron && (
                            <SessionTagBadge tag={{ type: 'cron' }} />
                          )}
                          <span className="truncate text-[14px]">{sessionTitle(s)}</span>
                        </div>
                        {/* 副信息：时间 + token 统计 */}
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                          <span className="flex items-center gap-0.5">
                            <Clock size={10} />
                            {formatTime(s.lastActiveAt)}
                          </span>
                          {hasStats && (
                            <>
                              <span>·</span>
                              <span>{stats.messageCount}条</span>
                              <span>·</span>
                              <span>{formatTokens(totalTokens)}</span>
                            </>
                          )}
                        </div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(isMenuOpen ? null : s.id); }}
                        className={`absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded transition-all ${
                          isMenuOpen
                            ? 'opacity-100 bg-[var(--hover)]'
                            : 'opacity-0 group-hover:opacity-100 hover:bg-[var(--hover)]'
                        }`}
                      >
                        <MoreHorizontal size={14} className="text-[var(--ink-secondary)]" />
                      </button>
                    </>
                  )}

                  {isMenuOpen && (
                    <div
                      className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-xl border border-[var(--border)] bg-white py-1"
                      style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
                    >
                      <button
                        onClick={() => startRename(s)}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
                      >
                        <Pencil size={14} />
                        重命名
                      </button>
                      <button
                        onClick={() => { onTogglePin(s.id); setMenuOpenId(null); }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
                      >
                        <Pin size={14} />
                        {isPinned ? '取消置顶' : '置顶'}
                      </button>
                      <button
                        onClick={() => {
                          setStatsSession({ id: s.id, title: sessionTitle(s) });
                          setMenuOpenId(null);
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--ink)] hover:bg-[var(--hover)] transition-colors"
                      >
                        <BarChart2 size={14} />
                        查看统计
                      </button>
                      {/* Disable delete for sessions with running cron tasks */}
                      {hasCron ? (
                        <button
                          disabled
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-[var(--ink-muted)] cursor-not-allowed opacity-40"
                          title="请先停止心跳循环后再删除"
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDeleteClick(s.id)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {hasMore && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full py-2 text-center text-[13px] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
              >
                查看更多（共 {sortedSessions.length} 个）
              </button>
            )}
          </div>
        )}
      </div>

      {/* 搜索弹窗 */}
      {showSearch && (
        <SearchModal
          onSelectSession={onSelectSession}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Session 统计弹窗 */}
      {statsSession && createPortal(
        <SessionStatsModal
          sessionId={statsSession.id}
          sessionTitle={statsSession.title}
          onClose={() => setStatsSession(null)}
        />,
        document.body,
      )}

      {/* 固定底部：更新提示 + 设置 */}
      <div style={{ padding: '0 14px 14px' }}>
        {updateReady && onRestartAndUpdate && (
          <button
            onClick={onRestartAndUpdate}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-2 mb-2 h-[38px] text-[13px] font-semibold text-white transition-all hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              animation: 'pulse 2s ease-in-out infinite',
            }}
          >
            <RefreshCw size={14} />
            重启以更新 {updateVersion && `v${updateVersion}`}
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className={`flex items-center gap-2.5 px-2 rounded-lg h-[38px] w-full transition-colors text-left ${
            isSettingsActive
              ? 'bg-[var(--hover)] text-[var(--ink)]'
              : 'hover:bg-[var(--hover)] text-[var(--ink)]'
          }`}
        >
          <span className="text-[14px] font-medium">设置</span>
        </button>
      </div>
    </div>
  );
}

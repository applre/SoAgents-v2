// Tab types for multi-tab architecture

import type { ImageAttachment } from '@/components/SimpleChatInput';
import type { PermissionMode } from '@/config/types';

/** Message data passed from Launcher to Chat for auto-send on workspace open.
 *  Security: Only stores providerId, never the API key. Chat builds providerEnv at send time. */
export interface InitialMessage {
    text: string;
    images?: ImageAttachment[];
    permissionMode?: PermissionMode;
    model?: string;
    providerId?: string;
    mcpEnabledServers?: string[];
}

/** 在 Tab 内打开的文件或 URL */
export interface OpenFile {
    filePath: string;       // 文件绝对路径 或 URL
    title: string;          // 显示名称
    mode: 'edit' | 'preview';
    isUrl?: boolean;        // true = URL，用 Tauri WebView 渲染
}

export interface Tab {
    id: string;
    agentDir: string | null;  // null = showing Launcher
    sessionId: string | null; // null = not started
    view: 'launcher' | 'chat' | 'settings';
    title: string;            // Display title for the tab
    isGenerating?: boolean;   // true = AI is outputting, used for close confirmation
    initialMessage?: InitialMessage;  // Launcher → Chat auto-send message
    // Note: cronTaskId and sidecarPort are no longer stored in Tab.
    // Sidecar lifecycle is now managed by SidecarManager's Owner model.
    // Use getSessionPort(sessionId) to get the port when needed.
    joinedExistingSidecar?: boolean;  // Tab joined an already-running sidecar (e.g. IM Bot session)
    /** 当前 Tab 内打开的文件列表（三栏布局 SecondTabBar 使用） */
    openFiles: OpenFile[];
    /** 当前激活的子 Tab：'chat' = 对话，string = 文件路径 */
    activeSubTab: 'chat' | string;
}

export interface TabState {
    tabs: Tab[];
    activeTabId: string | null;
}

// Maximum number of tabs allowed
export const MAX_TABS = 10;

// Generate unique tab ID
export function generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Generate session title from first message
export function generateSessionTitle(firstMessage: string): string {
    const maxLength = 20;
    const trimmed = firstMessage.trim();
    if (!trimmed) {
        return 'New Chat';
    }
    if (trimmed.length <= maxLength) {
        return trimmed;
    }
    return trimmed.slice(0, maxLength) + '...';
}

// Get folder name from path (supports both / and \ separators)
export function getFolderName(path: string): string {
    // Normalize path separators and split
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || path;
}

// Create a new empty tab (shows Launcher)
export function createNewTab(): Tab {
    return {
        id: generateTabId(),
        agentDir: null,
        sessionId: null,
        view: 'launcher',
        title: 'New Tab',
        openFiles: [],
        activeSubTab: 'chat',
    };
}

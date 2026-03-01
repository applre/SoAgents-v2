// AppConfig core — load, save, atomicModify, migration, availableProviders, bundledWorkspace, selfAwareness
import { join } from '@tauri-apps/api/path';
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import {
    type AppConfig,
    DEFAULT_CONFIG,
    type Project,
    type Provider,
} from '../types';
import {
    isBrowserDevMode,
    withConfigLock,
    ensureConfigDir,
    getConfigDir,
    CONFIG_FILE,
    safeLoadJson,
    safeWriteJson,
} from './configStore';
import {
    mockLoadConfig,
    mockSaveConfig,
} from '@/utils/browserMock';
import { type ImBotConfig, DEFAULT_IM_BOT_CONFIG } from '../../../shared/types/im';
import { isDebugMode } from '@/utils/debug';

// ============= Validation =============

function isValidAppConfig(data: unknown): data is AppConfig {
    return data !== null && typeof data === 'object' && !Array.isArray(data);
}

// ============= IM Bot Migration =============

let _imBotMigrationDone = false;

export function migrateImBotConfig(config: AppConfig): AppConfig {
    if (config.imBotConfig && !config.imBotConfigs && !_imBotMigrationDone) {
        _imBotMigrationDone = true;
        const legacy = config.imBotConfig;
        const migrated: ImBotConfig = {
            ...DEFAULT_IM_BOT_CONFIG,
            ...legacy,
            id: legacy.id || crypto.randomUUID(),
            name: legacy.name || 'Telegram Bot',
            platform: legacy.platform || 'telegram',
            setupCompleted: true,
        };
        config.imBotConfigs = [migrated];
        delete config.imBotConfig;
        saveAppConfig(config).catch(err => {
            console.error('[configService] Failed to persist imBotConfig migration:', err);
        });
    }
    return config;
}

// ============= Load / Save =============

export async function loadAppConfig(): Promise<AppConfig> {
    const dynamicDefault: AppConfig = {
        ...DEFAULT_CONFIG,
        showDevTools: isDebugMode(),
    };

    if (isBrowserDevMode()) {
        console.log('[configService] Browser mode: loading from localStorage');
        const loaded = mockLoadConfig();
        return { ...dynamicDefault, ...loaded };
    }

    try {
        await ensureConfigDir();
        const dir = await getConfigDir();
        const configPath = await join(dir, CONFIG_FILE);

        const loaded = await safeLoadJson<AppConfig>(configPath, isValidAppConfig);
        if (loaded) {
            const merged = { ...dynamicDefault, ...loaded };
            return migrateImBotConfig(merged);
        }
        return dynamicDefault;
    } catch (error) {
        console.error('[configService] Failed to load app config:', error);
        return dynamicDefault;
    }
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
    if (isBrowserDevMode()) {
        mockSaveConfig(config);
        return;
    }

    return withConfigLock(async () => {
        try {
            await _writeAppConfigLocked(config);
        } catch (error) {
            console.error('[configService] Failed to save app config:', error);
            throw error;
        }
    });
}

/**
 * Atomically read-modify-write the app config.
 */
export async function atomicModifyConfig(
    modifier: (config: AppConfig) => AppConfig,
): Promise<AppConfig> {
    if (isBrowserDevMode()) {
        const latest = await loadAppConfig();
        const modified = modifier(latest);
        mockSaveConfig(modified);
        return modified;
    }
    return withConfigLock(async () => {
        const latest = await loadAppConfig();
        const modified = modifier(latest);
        await _writeAppConfigLocked(modified);
        return modified;
    });
}

/**
 * Internal: write config to disk without acquiring withConfigLock.
 * MUST only be called from within a withConfigLock block.
 */
async function _writeAppConfigLocked(config: AppConfig): Promise<void> {
    if (isBrowserDevMode()) {
        mockSaveConfig(config);
        return;
    }
    await ensureConfigDir();
    const dir = await getConfigDir();
    const configPath = await join(dir, CONFIG_FILE);
    await safeWriteJson(configPath, config);
}

// ============= Available Providers Cache =============

// Forward declarations for circular-dependency-free import
// These are passed in from providerService via rebuildAndPersistAvailableProviders below
import type { ModelEntity } from '../types';

/**
 * Merge preset custom models into providers.
 * Shared utility used by both providerService and this module.
 */
export function mergePresetCustomModels(
    providers: Provider[],
    presetCustomModels: Record<string, ModelEntity[]> | undefined,
): Provider[] {
    if (!presetCustomModels || Object.keys(presetCustomModels).length === 0) {
        return providers;
    }
    return providers.map(provider => {
        if (!provider.isBuiltin) return provider;
        const customModels = presetCustomModels[provider.id];
        if (!customModels || customModels.length === 0) return provider;
        return {
            ...provider,
            models: [...provider.models, ...customModels],
        };
    });
}

// ============= Bundled Workspace =============

let _bundledWorkspaceChecked = false;

export async function ensureBundledWorkspace(): Promise<boolean> {
    if (_bundledWorkspaceChecked) return false;
    _bundledWorkspaceChecked = true;

    if (isBrowserDevMode()) return false;

    try {
        // Lazy import to break circular dep (addProject is in projectService)
        const { addProject } = await import('./projectService');
        const { loadProjects } = await import('./projectService');

        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ path: string; is_new: boolean }>('cmd_initialize_bundled_workspace');

        if (result.is_new) {
            await addProject(result.path);
            await withConfigLock(async () => {
                const config = await loadAppConfig();
                if (!config.defaultWorkspacePath) {
                    await _writeAppConfigLocked({ ...config, defaultWorkspacePath: result.path });
                }
            });
            console.log('[configService] Bundled workspace initialized:', result.path);
            return true;
        }

        const projects = await loadProjects();
        const normalizedResult = result.path.replace(/\\/g, '/');
        const found = projects.some(p => p.path.replace(/\\/g, '/') === normalizedResult);
        if (!found) {
            await addProject(result.path);
            console.log('[configService] Bundled workspace recovered into projects:', result.path);
            return true;
        }

        return false;
    } catch (err) {
        console.warn('[configService] ensureBundledWorkspace failed:', err);
        return false;
    }
}

// ============= Self-Awareness Workspace (Bug Report) =============

const SELF_AWARENESS_CLAUDE_MD_VERSION = '1';

const SELF_AWARENESS_CLAUDE_MD_CONTENT = `# MyAgents 自我诊断工作区

> 本文件由 MyAgents 自动生成，用于指导 AI 分析和诊断 MyAgents 自身的问题。

## 目录结构

\`\`\`
~/.myagents/
├── config.json          # 应用配置（含 Provider/MCP/权限等设置）
├── logs/
│   ├── unified-YYYY-MM-DD.log   # 统一日志（React + Bun Sidecar + Rust 三来源汇聚）
│   └── YYYY-MM-DD-sessionId.log # Agent 对话历史日志
├── skills/              # 用户自定义 Skills
├── agents/              # 用户自定义 Agents
└── projects.json        # 工作区列表
\`\`\`

## 统一日志格式

统一日志文件 \`logs/unified-YYYY-MM-DD.log\` 包含三个来源的日志：
- **[REACT]** — 前端日志（UI 交互、组件错误）
- **[BUN]** — Bun Sidecar 日志（Agent 执行、MCP 工具调用、SDK 交互）
- **[RUST]** — Rust 层日志（Sidecar 管理、SSE 代理、进程生命周期）

### 搜索技巧

| 问题类型 | 搜索关键词 |
|----------|-----------|
| AI 对话/Agent 异常 | \`[agent]\`, \`error\`, \`timeout\`, \`pre-warm\` |
| MCP 服务器问题 | \`MCP\`, \`mcp\`, \`tool\` |
| Sidecar 启动/连接 | \`[sidecar]\`, \`[proxy]\`, \`port\` |
| 前端 UI 异常 | \`[REACT]\`, \`Error\`, \`exception\` |
| IM Bot 问题 | \`[feishu]\`, \`[telegram]\`, \`[im]\` |
| 定时任务问题 | \`[CronTask]\`, \`[cron]\` |

## config.json 脱敏规则

读取 config.json 时，**必须对敏感信息脱敏**：
- \`providerApiKeys\` 中的所有 API Key：仅保留前 4 位和后 4 位，中间用 \`****\` 替代
- 示例：\`sk-ant-abc...xyz\` → \`sk-a****xyz\`

## Bug 报告格式

生成的诊断报告应包含以下结构：

\`\`\`markdown
## 环境信息
- App 版本: [从任务描述获取]
- 操作系统: [从日志或系统信息推断]
- 时间: [问题发生时间]

## 用户描述
[用户原始描述]

## 日志分析
### 关键错误
[从统一日志中提取的关键错误信息，附带时间戳]

### 上下文日志
[错误前后的关联日志条目]

## 环境配置
[从 config.json 提取的相关配置，已脱敏]

## 疑似原因
[基于日志和配置的分析结论]

## 建议
[可能的解决方案或临时规避措施]
\`\`\`

## GitHub Issue 提交

使用 \`gh issue create\` 命令提交到 \`hAcKlyc/MyAgents\` 仓库：
\`\`\`bash
gh issue create --repo hAcKlyc/MyAgents --title "bug: [简洁标题]" --label "bug,user-report" --body "[诊断报告内容]"
\`\`\`

确保：
- 标题简洁明了，以 \`bug:\` 开头
- 标签包含 \`bug\` 和 \`user-report\`
- 报告正文已对 API Key 等敏感信息脱敏
`;

/**
 * Maintain ~/.myagents/CLAUDE.md on app startup (version-gated to avoid unnecessary writes).
 */
export async function ensureSelfAwarenessClaudeMd(): Promise<void> {
    if (isBrowserDevMode()) return;
    try {
        const dir = await getConfigDir();
        const versionPath = await join(dir, '.claude-md-version');
        if (await exists(versionPath)) {
            const ver = await readTextFile(versionPath);
            if (ver.trim() === SELF_AWARENESS_CLAUDE_MD_VERSION) return;
        }
        const claudeMdPath = await join(dir, 'CLAUDE.md');
        await writeTextFile(claudeMdPath, SELF_AWARENESS_CLAUDE_MD_CONTENT);
        await writeTextFile(versionPath, SELF_AWARENESS_CLAUDE_MD_VERSION);
        console.log('[configService] Self-awareness CLAUDE.md written (version ' + SELF_AWARENESS_CLAUDE_MD_VERSION + ')');
    } catch (err) {
        console.warn('[configService] ensureSelfAwarenessClaudeMd failed:', err);
    }
}

/**
 * Ensure ~/.myagents is registered as an internal project. Called on-demand when user triggers bug report.
 *
 * Accepts ConfigProvider's wrapped actions (addProject/patchProject) so that both disk AND React state
 * are updated. Calling projectService directly would only write to disk, leaving ConfigProvider stale.
 */
export async function ensureSelfAwarenessWorkspace(
    projects: Project[],
    addProject: (path: string) => Promise<Project>,
    patchProject: (id: string, updates: Partial<Omit<Project, 'id'>>) => Promise<void>,
): Promise<Project | null> {
    if (isBrowserDevMode()) return null;
    try {
        const dir = await getConfigDir();
        const normalizedDir = dir.replace(/\\/g, '/');
        let project = projects.find(p => p.path.replace(/\\/g, '/') === normalizedDir);
        if (!project) {
            project = await addProject(dir);
        }
        if (project && !project.internal) {
            await patchProject(project.id, { internal: true, name: 'MyAgents 诊断' });
            // patchProject updates both disk and React state; use the patched fields locally
            project = { ...project, internal: true, name: 'MyAgents 诊断' };
        }
        await ensureSelfAwarenessClaudeMd();
        return project ?? null;
    } catch (err) {
        console.warn('[configService] ensureSelfAwarenessWorkspace failed:', err);
        return null;
    }
}

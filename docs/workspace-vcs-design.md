# Workspace Change History — UI & Implementation Spec

> Status: Implemented in v0.1.25+

## Overview

Agents naturally create, modify, and delete files as they complete tasks. The Workspace Changes panel lets users review what changed and explicitly "submit" those changes for safekeeping — without ever seeing git terminology.

The Changes panel lives as a **tab in the right-sidebar (DirectoryPanel)**, alongside the existing "Files" view.

---

## Terminology Map

| Git concept | UI label |
|---|---|
| uncommitted / working tree changes | **Pending Works** |
| `git commit` | **Submit** |
| commit history | **History** |
| untracked file | `+ New` |
| modified file | `~ Modified` |
| deleted file | `✕ Deleted` |

---

## UI Design

### DirectoryPanel — tab bar at top

```
┌─────────────────────────────────┐
│  [📁 Files]  [🔄 Changes (3)]   │
├─────────────────────────────────┤
│  (file tree or Changes panel)   │
└─────────────────────────────────┘
```

### Changes tab layout

```
┌─────────────────────────────────┐
│  Pending Works (3)              │
│  ────────────────────────────   │
│  + src/NewComponent.tsx         │
│  ~ src/api/client.ts            │
│  ✕ docs/old-guide.md            │
│                                 │
│  [___Description (optional)___] │
│  [        Submit         ]      │
│                                 │
│  History ─────────────────────  │
│  ○ 2 min ago   "Checkpoint"  3↑ │
│  ○ 2h ago      "Agent: fix"  1↑ │
└─────────────────────────────────┘
```

**Behavior:**
- Badge on "Changes" tab shows count of pending files; disappears at 0
- No pending → "All caught up" empty state
- No git repo → "VCS not initialized" + [Initialize] button
- History entries: relative time, message, file count

---

## Backend API (Bun Sidecar — `/api/git/`)

All endpoints operate on the tab's `workspacePath` / `agentDir`.

### `GET /api/git/status`

Returns pending (uncommitted) file changes.

**Response:**
```json
{
  "files": [
    { "path": "src/NewComponent.tsx", "status": "new" },
    { "path": "src/api/client.ts", "status": "modified" },
    { "path": "docs/old-guide.md", "status": "deleted" }
  ],
  "gitInitialized": true
}
```

Status values map from `git status --porcelain`:
- `??` → `"new"` (untracked)
- `M` or `AM` → `"modified"`
- `D` → `"deleted"`

### `GET /api/git/log`

Returns the last 30 commits.

**Response:**
```json
{
  "entries": [
    { "hash": "abc123", "message": "Checkpoint", "date": "2025-01-01T10:00:00Z", "author": "MyAgents", "numFiles": 3 }
  ],
  "gitInitialized": true
}
```

### `POST /api/git/submit`

Stages all changes and creates a commit.

**Request:** `{ "message": "optional description" }`  
**Response:** `{ "success": true, "hash": "abc123" }` or `{ "success": false, "error": "..." }`

Default message: `"Checkpoint"`

### `POST /api/git/init`

Initializes a git repository in the workspace.

**Response:** `{ "initialized": true }`

Also writes a default `.gitignore` and sets local git user config.

---

## Component Structure

### `WorkspaceChangesPanel.tsx`

- Uses Tab-scoped API (`useTabApi` / `apiGet`, `apiPost`) to call git endpoints
- Polls `GET /api/git/status` on mount and after agent turn completes
- Submit: `POST /api/git/submit` → re-fetches status + log
- Initialize: `POST /api/git/init` → re-fetches status

**State:**
```typescript
pendingFiles: { path: string, status: 'new' | 'modified' | 'deleted' }[]
history: { hash: string, message: string, date: string, numFiles: number }[]
description: string
isSubmitting: boolean
isLoading: boolean
gitInitialized: boolean
```

### `DirectoryPanel.tsx` changes

- Added `activeTab: 'files' | 'changes'` local state
- Tab bar above existing content: "📁 Files" | "🔄 Changes (N)"
- Renders `<WorkspaceChangesPanel agentDir={agentDir} />` when Changes tab active
- No changes to file tree, AgentCapabilitiesPanel, or Chat layout

---

## Auto-Init

On sidecar startup, if `workspacePath`:
- Is not a temp directory (`/tmp`, `%TEMP%`)
- Does not already have a `.git/` directory

→ Automatically runs `git init` + writes `.gitignore`.

---

## Git Gitignore Defaults

```gitignore
node_modules/
dist/
build/
.env
*.log
__pycache__/
.DS_Store
*.pyc
.venv/
```

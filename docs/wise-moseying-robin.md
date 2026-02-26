# Plan: Workspace Change History Panel

## Context

The old `workspace-vcs-design.md` focused on the git plumbing (init, commit, gitignore). This plan replaces it with a concrete UI + implementation spec.

Agents naturally create/modify/delete files as they complete tasks. Users need to see what changed and explicitly "submit" those changes for safekeeping — without ever seeing git terminology.

The Changes panel will live as a **tab in the existing right-sidebar (DirectoryPanel)**, alongside the current "Files" view, so users can toggle between exploring the file tree and reviewing pending works without leaving the Chat view.

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

### DirectoryPanel — new tab bar at top

```
┌─────────────────────────────────┐
│  [📁 Files]  [🔄 Changes (3)]   │
├─────────────────────────────────┤
│  (existing file tree or         │
│   new ChangesPanel below)       │
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

- Badge on the "Changes" tab shows count of pending files
- Badge disappears (or shows 0) when nothing is pending
- History entries show: relative time, message, file count
- No pending → show "All caught up" empty state
- No git repo → show "VCS not initialized" with an [Initialize] button

---

## Implementation Plan

### Phase 1 — Backend Git API (Bun sidecar)

**New file:** `src/server/git.ts`

Exports a Hono router mounted at `/api/git/` in `src/server/index.ts`.

Endpoints:

| Method | Path | Command | Response |
|---|---|---|---|
| GET | `/api/git/status` | `git status --porcelain` | `{ files: [{ path, status }] }` |
| GET | `/api/git/log` | `git log --format=%H|%s|%ai|%an -n 30` | `{ entries: [{ hash, message, date, author, numFiles }] }` |
| POST | `/api/git/submit` | `git add -A && git commit -m "..."` | `{ success, hash }` |
| POST | `/api/git/init` | `git init && write .gitignore` | `{ initialized: bool }` |

**Auto-init on sidecar startup** (in `src/server/index.ts` startup block):
- If `workspacePath` is not under `/tmp` or `%TEMP%`
- And `.git/` does not exist → call `git init` + write default `.gitignore`
- Reuse the logic from `src/server/git.ts`

`status` field values from `--porcelain`: `'?'` (new/untracked), `'M'` (modified), `'D'` (deleted).

### Phase 2 — New React component

**New file:** `src/renderer/components/WorkspaceChangesPanel.tsx`

Uses Tab-scoped API (`useTabState` → `apiGet`, `apiPost`) to call the new git endpoints.

State:
- `pendingFiles: { path: string, status: 'new' | 'modified' | 'deleted' }[]`
- `history: { hash: string, message: string, date: string, numFiles: number }[]`
- `description: string` — optional submit message
- `isSubmitting: boolean`
- `isLoading: boolean`
- `gitInitialized: boolean`

Behavior:
- Polls `GET /api/git/status` on mount and after each agent turn completes (listen to SSE `turn:complete` event or refresh key from parent)
- Submit calls `POST /api/git/submit` with description (defaults to `"Checkpoint"` if empty)
- After submit, re-fetch both status and log
- [Initialize] button calls `POST /api/git/init` when git not set up

### Phase 3 — Integrate into DirectoryPanel

**File to modify:** `src/renderer/components/DirectoryPanel.tsx`

Changes:
1. Add local state `activeTab: 'files' | 'changes'`
2. Add tab bar at top of panel (after title/header area) with:
   - "Files" tab (existing content — no changes to file tree or AgentCapabilitiesPanel)
   - "Changes" tab with a count badge (count from `pendingCount` prop or internal state)
3. Render `<WorkspaceChangesPanel agentDir={agentDir} />` when `activeTab === 'changes'`
4. Pass `agentDir` prop (already available in DirectoryPanel) into WorkspaceChangesPanel

**No changes** to the existing file tree, AgentCapabilitiesPanel, or Chat.tsx layout.

### Phase 4 — Update design doc

Replace `docs/workspace-vcs-design.md` content with the finalized UI + API spec from this plan (terminology, endpoints, component structure) so the doc reflects what was actually built.

---

## Files Changed

| File | Change |
|---|---|
| `src/server/git.ts` | New — git API router |
| `src/server/index.ts` | Mount git router; add auto-init on startup |
| `src/renderer/components/WorkspaceChangesPanel.tsx` | New — Changes UI component |
| `src/renderer/components/DirectoryPanel.tsx` | Add tab bar + render ChangesPanel |
| `docs/workspace-vcs-design.md` | Rewrite with final spec |

---

## Verification

1. Open a workspace that has no `.git` → sidecar auto-inits → Changes tab shows "All caught up"
2. Ask agent to create or edit a file → switch to Changes tab → see file in Pending Works with correct status badge
3. Type a description, click Submit → success toast → Pending Works clears → History gains a new entry
4. Click [Initialize] button on a workspace that git-failed to auto-init → `.git` appears on disk
5. History entries show correct relative timestamps and file counts
6. Tab badge on "Changes" shows live count; disappears when 0 pending

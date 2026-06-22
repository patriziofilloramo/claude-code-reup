# Technical Spec: Cross-Device Project Memory Sync

## 1. Core Logic

The system uses filesystem redirection (Junctions/Symlinks).

- **Source:** `~/.claude/projects/<project-id>`
- **Target:** `<project-root>/.claude-memory/`

A project is "Linked" if a `.swoop-link` marker exists in the Source directory, pointing to the Target.

## 2. Issues & Fixes

### A. The "KO" Icon Visibility

**Issue:** Cloud icons appear whenever a link is detected, even if the feature is globally disabled.
**Fix:** UI rendering logic must guard the `isLinked` check with `APP.enableProjectMemorySync`.

### B. Performance: Advanced Discovery

**Issue:** Scanning the entire disk for `.claude-memory` folders is slow.
**Fix:**

1. Implement `APP.enableAdvancedDiscovery` (default: false).
2. Define `APP.projectSearchPaths` (e.g., `['~/Documents/Projects']`).
3. Only scan the defined paths for the `.claude-memory` marker if the toggle is ON.

## 3. Implementation Plan

### Config Updates (`src/config/app.ts`)

- Add `enableProjectMemorySync`.
- Add `enableAdvancedDiscovery`.
- Add `projectSearchPaths`.
- Rename `cloudMemoryDir` to `sharedMemoryDir`.

### Discovery Logic (`src/core/discovery.ts`)

```typescript
async function discoverProjects() {
  // 1. Always load local projects from Claude Index
  const localProjects = await loadClaudeIndex()

  if (!APP.enableProjectMemorySync) {
    return localProjects // No icons, no shared memory.
  }

  // 2. If Advanced Discovery is ON, scan specific paths
  if (APP.enableAdvancedDiscovery) {
    const exposedProjects = await scanPathsForSharedMemory(APP.projectSearchPaths)
    // Merge logic...
  }
}
```

### UI Icon Logic (Web/TUI)

The status of the cloud icon should be determined by a `SyncStatus` helper:

```typescript
function getProjectSyncStatus(project) {
  if (!APP.enableProjectMemorySync) return null // Hides icon completely

  if (!project.isLinked) return 'none'

  const presence = project.devicePresence // Read from shared folder
  const allLinked = presence.every((d) => d.isLinked)
  const reachable = checkPath(project.sharedPath)

  if (!reachable) return 'grey'
  return allLinked ? 'green' : 'orange'
}
```

## 4. Value Proposition

This feature is high-value for developers moving between a workstation and a laptop. By moving the "memory" into the project root:

1. **Context follows the code:** Git branch and history stay aligned.
2. **Zero-Config on Device B:** Simply running `swoop sync link` on a new device connects it to the existing "Project Memory" without manual ID matching.
3. **Local-First:** No reliance on third-party APIs for synchronization; the user's existing Cloud Drive (Dropbox/OneDrive/pCloud) handles the transport safely.

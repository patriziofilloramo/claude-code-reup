# Milestone 12 — Organization Layer: Plan

**Goal:** Make Swoop genuinely useful when Claude Code work becomes many parallel threads.
Triage in seconds, not minutes. Group by intent, not by filesystem path.

---

## What's already built

| Component                                                                                                                           | Status  |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `session-automatic-context.ts` — extracts plans, TODOs, touched files, research trail, tool health, agent activity, execution facts | ✅ done |
| `SessionPreview.automaticContext` included in every preview API response                                                            | ✅ done |
| TUI Resume Card shows native plan + TODO state (read-only)                                                                          | ✅ done |
| Web inspector: `buildNativePlanHtml` + `buildNativeTodosHtml` exist in `07-filter-inspector.js`                                     | ✅ done |
| Web inspector: research trail, tool health, source/freshness labels                                                                 | ✅ done |
| Session tags, project tags, project groups, work stacks                                                                             | ✅ done |
| Left rail (Inbox / Smart / Stacks / Groups)                                                                                         | ✅ done |

---

## Architecture decisions

### Storage split — final

| What                                           | Where                        | Rationale                                                 |
| ---------------------------------------------- | ---------------------------- | --------------------------------------------------------- |
| Session alias, archived, session tags          | `swoop.json` per-project     | Per-project locality; existing atomic write queue         |
| Project tags                                   | `swoop.json` per-project     | Lives beside the sessions it qualifies                    |
| Groups, stacks, tag palette, group assignments | `~/.claude/swoop/org.json`   | Global, cross-project; own write queue + advisory lock    |
| Smart Views                                    | Computed — zero storage      | Derived from `SessionSignals` + `AutomaticSessionContext` |
| User preferences (theme, cleanup)              | `~/.claude/swoop/prefs.json` | Scalar prefs only — never modified by org operations      |

`prefs.json` stays untouched. Org data lives in `org.json`. `swoop config set` can never
corrupt organization data.

### `org.json` specification

```typescript
interface OrgData {
  schemaVersion: 1
  tagPalette: string[] // global ordered list of known tags
  groups: ProjectGroup[]
  stacks: WorkStack[]
  projectGroupAssignments: Record<string, string> // projectId → groupId
}

interface ProjectGroup {
  id: string // UUID
  name: string // unique per org, max 64 chars, trimmed
  color?: string // e.g. "#6b7fd4"
}

interface WorkStack {
  id: string // UUID
  name: string // unique per org, max 64 chars, trimmed
  items: StackItem[]
  color?: string
}

interface StackItem {
  kind: 'project' | 'session'
  projectId: string
  sessionId?: string // only when kind === 'session'
}
```

Empty state: `{ schemaVersion: 1, tagPalette: [], groups: [], stacks: [], projectGroupAssignments: {} }`

**`withOrgLock(updater)`** — mirrors `enqueueProjectSidecarUpdate`: in-process promise queue
serializing concurrent writes + advisory filesystem lock for multi-process safety. Atomic
write via temp file + rename, same retry logic as `swoop.json`.

**Schema version safety** — `readOrgData()` can degrade gracefully (unknown version → return
empty state for UI display). Any write path (`withOrgLock`) must check `schemaVersion` first
and throw explicitly if unknown:

```typescript
if (data.schemaVersion !== 1) {
  throw new Error(`org.json: unsupported schemaVersion ${data.schemaVersion} — refusing write`)
}
```

This prevents a downgraded Swoop instance from silently wiping a v2+ org file with an empty
state overwrite. UI reads degrade; writes never silently corrupt.

**SSE invalidation** — the file watcher in `event-stream-route.ts` watches `~/.claude/swoop/`.
Changes to `org.json` emit a `change` SSE event, triggering a full `/api/projects` + `/api/org`
refresh on connected clients.

### Export/import scope (MVP)

`org.json` is the export payload: groups, stacks, palette, and group assignments.

Session tags and project tags stay in `swoop.json` per-project — they have per-project locality
and would make `org.json` excessively noisy. Full tag export (sweeping all `swoop.json` sidecars)
is a Phase 4 feature. MVP export/import is simply: copy `org.json`.

### `tagPalette` is best-effort cache, not source of truth

Applying a tag writes `swoop.json` (the tag itself). Updating the palette writes `org.json`
(recency cache for the picker). These are two independent writes — there is no transaction.

If the palette update fails, the tag on the session remains valid. The palette can be
reconstructed by sweeping all sidecars if needed. No operation should fail because palette
update failed; callers log the palette write error and proceed.

### Smart Views — computed, not stored

Smart Views are virtual filters computed client-side from signals already present in every
`/api/projects` response. Zero backend changes required.

| View             | Condition                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Active now       | `session.id ∈ activeSessionIds`                                                                      |
| Needs attention  | `signals.interrupted \|\| signals.lastToolFailed` — path-missing and expiring have their own buckets |
| Branch drift     | `session.gitBranch && session.currentBranch && session.gitBranch !== session.currentBranch`          |
| Path missing     | `!signals.pathExists` — separate bucket; not folded into "Needs attention"                           |
| High context     | `context.latestContextTokens >= CONTEXT_HIGH_THRESHOLD` (`CONTEXT_HIGH_THRESHOLD = 150_000` tokens)  |
| Expiring soon    | `signals.expiresInDays !== null && signals.expiresInDays <= 7`                                       |
| Recently touched | `Date.parse(session.updated) >= Date.now() - RECENT_WITHIN_DAYS * 86_400_000`                        |
| Has open TODOs   | requires preview — shown in Inspector only, not an Inbox bucket in MVP                               |
| Planned          | same — preview-dependent; surfaced in Inspector                                                      |

"Needs attention" is intentionally narrower than the original plan: it covers only interrupted work
and failed tools — things requiring the developer's direct response. Path-missing and Expiring soon
are independently actionable and surface better as their own buckets. The filter pill "Needs
Attention" retains the broader definition (interrupted || expiring || path-missing) for the main
session list.

### Shared core for org reads and filtering

TUI and CLI use core directly — they never call the web server. Routes also call core.
All org reads go through `readOrgData()` from `src/core/org/org-prefs.ts`. Filtering is a
pure function in `src/core/org/org-filters.ts`:

```typescript
export function filterProjectsByOrg(
  projects: Project[],
  orgData: OrgData,
  filter: { groupId?: string; stackId?: string; tag?: string }
): Project[]
```

Web routes, `swoop list`, and TUI all call this same function. No HTTP between CLI/TUI and the org layer.

### Validation rules

Applied at route layer before any core function is called:

- **Tag name**: lowercase-normalized, stripped of leading/trailing whitespace, max 32 chars,
  `[a-z0-9-]` only, non-empty after normalization
- **Tags per session**: max 8
- **Group/stack name**: trimmed, max 64 chars, non-empty, unique within its type in `org.json`
- **Stack items**: no duplicate `(projectId, sessionId)` pairs within one stack
- **Group assignments**: one group per project; reassigning replaces old assignment

### Stack and group counts

- **Stack count**: number of unique `(projectId, sessionId)` pairs that are non-archived.
  When a stack contains both a project P and a specific session S from P, session S is counted
  once — not twice. Deduplication is by `(projectId, sessionId)` pair before summing.
- **Group count**: number of projects assigned to the group.

### Focus mode

Transient — stored in `localStorage` (`swoop:focus`). Clearing focus is client-only, no
server call. The focus bar shows the active filter. Search is scoped to the current focus;
no silent global fallback. An explicit "Clear focus" or Escape exits focus and returns to
the global view.

### Server-side filters

`/api/projects` adds `?group=:id`, `?stack=:id`, and `?tag=:tag` — these only require reading
`org.json` and `swoop.json` sidecars, no transcript scan.

`?todo` and `?planned` are **not added** in the MVP: they require transcript preview data that
is not stored in the sidecar. CLI commands `--todo` and `--planned` are Phase 3+ and will do
their own transcript scan.

---

## The centerpiece: Triage Inbox

The Inbox is the first section of the left rail. It is a focus filter — selecting a bucket
narrows the existing project + session panels to matching items. The Inbox does **not** show
a cross-project flat session list (that would require a new layout and is out of MVP scope).

MVP model: selecting "Needs attention" in the Inbox sets `focusFilter = { smartView: 'attention' }`.
The project panel hides projects with no matching sessions; the session panel shows only matching
sessions within the selected project. Same layout, focused content.

```
INBOX
  🔴 Active now              (2 sessions across all projects)
  🟠 Needs attention         (5)   interrupted / tool failed / expiring
  🟡 Branch drift            (3)   gitBranch ≠ currentBranch
  ⬛ Path missing            (1)   project folder deleted/moved
  🔵 High context            (4)   latestContextTokens > 150,000
  ⏱  Expiring soon           (1)   ≤ 7 days on transcript
  🟣 Recently touched        (7)   last 7 days, not in above buckets
```

Rules:

- A session appears in the **first bucket** it qualifies for (priority order above)
- Archived sessions never appear in any Inbox bucket
- Counts are cross-project totals (for the number label), but the view remains project-scoped
- Empty Inbox = "Nothing needs attention" message; clean state is a feature

This is Swoop's standout differentiator: one view that tells you what matters without requiring
the user to have set up any tags, groups, or stacks first.

---

## Data schema

### `swoop.json` additions (per-project)

```typescript
interface SessionSidecarMetadata {
  alias?: string
  archived?: boolean
  tags?: string[] // NEW: e.g. ["bug", "release", "waiting"]
}

interface ProjectSidecarMetadata {
  sessions?: Record<string, SessionSidecarMetadata>
  projectTags?: string[] // NEW: applies to all sessions in this project
}
```

### `Session` and `Project` model additions

```typescript
interface Session {
  // ...existing fields
  tags?: string[] // NEW: merged from swoop.json
}

interface Project {
  // ...existing fields
  group?: string // NEW: groupId from org.json projectGroupAssignments
  projectTags?: string[] // NEW: from swoop.json
}
```

---

## API contract

### New endpoints

```
# Session tags
PUT  /api/projects/:projectId/sessions/:sessionId/tags
     body: { tags: string[] }   → replaces entire tag list after validation

# Project tags
PUT  /api/projects/:projectId/tags
     body: { tags: string[] }

# Project group assignment
PUT  /api/projects/:projectId/group
     body: { groupId: string | null }

# Org data
GET    /api/org
       → { groups, stacks, tagPalette, projectGroupAssignments, schemaVersion }

POST   /api/org/groups
       body: { name: string, color?: string }   → { group: ProjectGroup }

PUT    /api/org/groups/:groupId
       body: { name?: string, color?: string }

DELETE /api/org/groups/:groupId
       (removes group and clears all projectGroupAssignments pointing to it)

POST   /api/org/stacks
       body: { name: string, color?: string }   → { stack: WorkStack }

PUT    /api/org/stacks/:stackId
       body: { name?: string, color?: string }

DELETE /api/org/stacks/:stackId

POST   /api/org/stacks/:stackId/items
       body: { kind: 'project'|'session', projectId: string, sessionId?: string }

DELETE /api/org/stacks/:stackId/items/:itemRef
       (itemRef = projectId or projectId:sessionId)
```

### Existing endpoints — extended

```
GET /api/projects?group=:id&stack=:id&tag=:tag
    (existing behavior unchanged when absent; no ?todo or ?planned in MVP)

GET /api/projects/search?q=:query&tag=:tag&group=:id&stack=:id
    metadata/alias search in project-routes.ts — org filters added here
    (search-route.ts handles deep/transcript search — separate endpoint, left untouched)
```

---

## Phases

### Phase 1 — Foundation (≈3 days)

**Goal:** Core data layer, `org.json` infrastructure, extended APIs, inspector improvements.
No visual overhaul — the UI looks the same but is ready underneath.

#### 1a — `org.json` infrastructure ✅

- [x] `src/core/org/org-model.ts` — `OrgData`, `ProjectGroup`, `WorkStack`, `StackItem` interfaces
- [x] `src/core/org/org-prefs.ts` — `readOrgData()`, `withOrgLock(updater)`, `writeOrgDataAtomically()`
      Modelled on `project-sidecar-lock.ts` + `session-metadata.ts` patterns
- [x] `readOrgData()` initialises empty state when file missing (no throw)
- [x] `readOrgData()` on unknown `schemaVersion`: log warning, return empty for UI reads only
- [x] `withOrgLock(updater)`: if `schemaVersion` unknown, throw before any mutation (never overwrite)
- [x] `src/core/org/org-filters.ts` — `filterProjectsByOrg(projects, orgData, filter)` pure function;
      used by web routes, `swoop list`, and TUI — single source of truth, no HTTP
- [x] File watcher in `event-stream-route.ts` extended to watch `org.json` alongside `swoop.json`

#### 1b — `swoop.json` extensions ✅

- [x] Extend `SessionSidecarMetadata` with `tags?: string[]`
- [x] Extend `ProjectSidecarMetadata` with `projectTags?: string[]`
- [x] `setSessionTags(projectId, sessionId, tags)` — validates, normalizes, writes via existing queue
- [x] `setProjectTags(projectId, tags)` — same
- [x] `mergeProjectSidecarMetadata` merges tags into `Session` and project-level tags into `Project`

#### 1c — Model extensions ✅

- [x] Add `tags?: string[]` to `Session` in `session-model.ts`
- [x] Add `group?: string`, `projectTags?: string[]` to `Project` in `session-model.ts`
- [x] `project-discovery.ts` resolves `group` from `org.json` during project assembly

#### 1d — Org CRUD functions ✅

- [x] `createGroup(name, color?)`, `updateGroup(id, patch)`, `deleteGroup(id)`
      `deleteGroup` clears all `projectGroupAssignments` for that id
- [x] `setProjectGroup(projectId, groupId | null)`
- [x] `createStack(name, color?)`, `updateStack(id, patch)`, `deleteStack(id)`
- [x] `addStackItem(stackId, item)`, `removeStackItem(stackId, itemRef)`
- [x] All functions validate input per validation rules before mutating

#### 1e — API routes ✅

- [x] `src/web/routes/org-routes.ts` — all `/api/org/**` endpoints
- [x] `src/web/routes/session-metadata-routes.ts` — tag mutation endpoints
- [x] Extend `project-routes.ts`: GET `/api/projects` with `?group`, `?stack`, `?tag` filters;
      metadata search in same file extended with `?tag`, `?group`, `?stack`
      (`search-route.ts` is deep/transcript search — leave untouched)

#### 1f — Web inspector: complete the automatic context display ✅

`buildNativePlanHtml` and `buildNativeTodosHtml` already exist. Add:

- [x] Research trail section: `readFiles` list + `researchActions` (glob/grep/web) when present
- [x] Tool health section: failed/interrupted tools with names and timestamps
- [x] Source/freshness labels on Plan and TODO sections (from `source` + `updatedAt` fields)
- [x] All new strings added to `STRINGS` in `00-strings.js`

#### 1g — Tests ✅

- [x] Unit: `withOrgLock` concurrent-write serialization (two overlapping promises)
- [x] Unit: `createGroup` / `deleteGroup` → assignments cleared
- [x] Unit: `addStackItem` deduplicate guard
- [x] Unit: tag validation (length, chars, dedupe, max count)
- [x] Unit: `setSessionTags` roundtrip via sidecar read
- [x] Route: `PUT /api/projects/:id/sessions/:sid/tags` — happy path + invalid body
- [x] Route: `GET /api/org` — empty state + populated state
- [x] Route: `GET /api/projects?tag=bug` — correct filter
- [x] Route: `DELETE /api/org/groups/:id` — assignments cleaned up

---

### Phase 2 — Web Organization UI (≈4 days)

**Goal:** Triage Inbox, left rail, chips, focus bar, tag/group/stack pickers. The product shape.

#### 2a — Left rail

Add a collapsible rail above the existing project list:

```
┌─────────────────────────────────────┐
│ INBOX                           [▾] │  ← always first; shows bucket counts
│   🔴 Active now             (2)     │
│   🟠 Needs attention        (5)     │
│   🟡 Branch drift           (3)     │
│   ⬛ Path missing           (1)     │
│   🔵 High context           (4)     │
│   ⏱  Expiring soon          (1)     │
│   🟣 Recently touched       (7)     │
├─────────────────────────────────────┤
│ ⬡ STACKS                       [▾] │
│   Auth migration            (4)     │
│   Launch week               (7)     │
│   + new stack                       │
├─────────────────────────────────────┤
│ ⊞ GROUPS                       [▾] │
│   Work                      (12)    │
│   Personal                   (3)    │
│   + new group                       │
├─────────────────────────────────────┤
│ PROJECTS [14]                       │  ← existing list, unchanged
└─────────────────────────────────────┘
```

- [x] Rail sections rendered above `.proj-list`
- [x] Section collapse state persisted in `localStorage` (one key per section)
- [x] Inbox items computed client-side from `projects` + `activeSessionIds` (no new API)
- [x] Stacks/Groups populated from `GET /api/org` (fetched alongside `/api/projects`)
- [x] Counts: Inbox is exclusive by priority; stack = visible sessions; group = project count
- [x] Selecting any rail item sets `focusFilter` and re-renders both panels
- [x] Inline creation is available from the keyboard/context picker and immediately applies the item

#### 2b — Focus bar

```
┌─────────────────────────────────────────────────────┐
│ Focus: Launch week  ×    showing 4 of 14 projects   │
└─────────────────────────────────────────────────────┘
```

- [x] Shown below search bar, above filter pills, when focus or search is active
- [x] Search within focus scope only (no silent global fallback)
- [x] `×` clears focus; Escape from search input clears focus too
- [x] `fmt(STRINGS.focusBar, { name, n, total })` pattern

#### 2c — Session + project chips

```
● session name  [bug] [+1]  ⎇ feat/login  5m
```

- [x] Session tags rendered as chips in session rows: max 2 visible + `+N` overflow
- [x] Project tags shown beside project name in project rows
- [x] Chips are clickable → sets tag focus filter
- [x] Chips use compact accent styling
- [x] Group indicator shown on assigned project rows

#### 2d — Tag picker (`t` key)

Minimal overlay, keyboard-driven:

```
Tag session   [bug filter or new tag   ]
  ✓ bug         (current)
    release
    waiting
  + Create "deploy"
```

- [x] Opens on `t` for the selected session/project and from Inspector/context menus
- [x] Shows palette sorted by recency (most recently used first)
- [x] Typing filters; Enter selects or creates
- [x] Existing tags can be removed; one `PUT` is issued on commit
- [x] Keyboard: arrows navigate, Enter select/create, Escape cancels
- [x] Added to `STRINGS` + footer hint

#### 2e — Group/Stack picker (`g` key)

```
Move to group / stack   [filter...     ]
  Groups:
    ✓ Work
      Personal
  Stacks:
      Auth migration
      Launch week
  + New stack
```

- [x] Opens the relevant group/stack picker on `g`
- [x] Checkmarks show current membership; stack membership toggles add/remove
- [x] Fires `PUT /api/projects/:id/group` or `POST/DELETE /api/org/stacks/:id/items`
- [x] New group/stack inline creation at bottom
- [x] Footer hint added

#### 2f — Context menu additions

- [x] Session row right-click: `Tag…`, `Move to stack…`, `Archive`, `Delete`, `Copy ID`
- [x] Project row right-click: `Tag project…`, `Move to group…`, `Move to stack…`, `New session`, `Copy path`

#### 2g — Inspector org editor

Below the action buttons in the inspector:

```
Organization
Tags       [bug] [release] [+ add]
Stack      Launch week ▾
Group      Work
```

- [x] Tags: chips + tag picker
- [x] Stack/Group: picker actions apply immediately

#### 2h — "Save as stack" from search/focus

- [x] When a search or Smart View focus is active, show `Save as stack` in the focus bar
- [x] Creates a new stack containing the visible sessions

#### 2i — Tests

- [ ] Unit: Inbox bucket assignment (priority ordering, archived excluded)
- [ ] Unit: Smart View counts correct from fixture projects
- [ ] Unit: focus filter applied to project/session list
- [ ] Unit: chip overflow cap (`buildTagChipsHtml(tags, max)`)
- [ ] Unit: tag picker recent-first sort
- [ ] Manual smoke: `t` → tag → chip appears → click chip → focus filters

---

### Phase 3 — TUI + CLI read/filter parity (≈2 days)

**Goal:** Display org data and filter by it from TUI and CLI. Editing org data (tagging,
grouping, stack assignment) stays in the web UI for now.

#### 3a — TUI

- [x] Session rows show tag chips (abbreviated, max 2, elided) when space allows
- [x] Project rows show group name (abbreviated) when assigned
- [x] Footer hints: `f focus  esc clear` (no `t`/`g` edit pickers in MVP)
- [x] `f` cycles Inbox Smart View buckets (filter-only, no org mutation)
- [x] TUI Resume Card shows source/freshness labels for native plan and TODO state
- [x] Command palette: `Focus: [Inbox bucket]`, `Clear focus`
- [ ] **Not in MVP**: tag picker (`t`), group/stack picker (`g`) — editing stays in web

#### 3b — CLI

- [x] `swoop list --group <name>` — projects in group, via `readOrgData()` + `filterProjectsByOrg()`
- [x] `swoop list --stack <name>` — items in stack, same core path
- [x] `swoop list --tag <name>` — sessions with matching tag, reads `swoop.json` sidecars directly
- [x] `swoop list --json` — `tags`, `group`, `projectTags` included in output
- [x] Help text and completion scripts updated
- [ ] `--todo` and `--planned` deferred (require transcript scan; out of MVP scope)
- [x] No HTTP calls to web server; all data from core (`readOrgData`, `readProjectSidecar`)

#### 3c — Tests

- [x] Integration: `swoop list --tag bug` returns only tagged sessions
- [x] Integration: `swoop list --group work` returns only assigned projects
- [x] Integration: `swoop list --stack launch` returns stack members
- [x] Unit: shared Smart View priority, archived exclusion, filtering, and cycling
- [x] Regression: TUI group/focus/provenance surfaces and CLI help/completion flags

---

### Phase 4 — Advanced (after MVP is proven in real use)

- [ ] `--todo pending` and `--planned` CLI filters (transcript scan)
- [ ] Auto-suggest tags (branch prefix, folder name, status heuristics — opt-in in config)
- [ ] **Full org export**: `swoop org export` → `org.json` + sweeps all `swoop.json` sidecars for tags
- [ ] **Org import**: `swoop org import` with merge strategy (skip / overwrite / ask)
- [ ] Quick clean sweep — bulk archive from group/stack, skips active sessions
- [ ] Drag-to-stack (after g picker is proven sufficient)
- [ ] TODO-aware and plan-aware triage (requires `hasTodos`/`hasPlans` persisted in sidecar after analysis)

---

## Full web layout — after Phase 2

```
┌────────────────────────────────────────────────────────────────────────────┐
│  swoop  [search________________________]  usage bar  [diagnostics] [theme]  │
│──────────────────────────────────────────────────────────────────────────── │
│ Focus: Launch week  ×    showing 4 of 14 projects                          │
│──────────────────────────────────────────────────────────────────────────── │
│ All | Needs Attention | Active | Archived         Sort: Recent ▾            │
├──────────────────┬─────────────────────────────────┬───────────────────────┤
│ INBOX        [▾] │ ● my-project/auth          [▾]  │  Session Name         │
│  🔴 Active   (2) │   [bug] [+1]  ⎇ feat/login  5m │  ─────────────────    │
│  🟠 Attn     (5) │   working session               │  Goal: Fix auth flow  │
│  🟡 Drift    (3) │                                  │  for mobile           │
│  🔵 Ctx      (4) │ ● other-project            [▾]  │                       │
│  ⏱ Expiring  (1) │   [release]  ⎇ main  2h         │  ── Plan ──────────   │
│  🟣 Recent   (7) │   another session               │  Implement JWT…       │
├──────────────────┤                                  │  source: plan file    │
│ ⬡ STACKS     [▾] │                                  │  updated 2h ago       │
│ ▶ Auth migr  (4) │                                  │                       │
│   Launch wk  (7) │                                  │  ── TODOs ─────────   │
│   + new stack    │                                  │  ✓ 3  ◐ 1  ○ 2      │
├──────────────────┤                                  │  • Fix refresh token  │
│ ⊞ GROUPS     [▾] │                                  │  • Add tests          │
│   Work      (12) │                                  │                       │
│   Personal   (3) │                                  │  ── Research ──────   │
│   + new group    │                                  │  Read: auth.ts        │
├──────────────────┤                                  │  Grep: "useAuth"      │
│ PROJECTS [14]    │                                  │                       │
│  ● my-project    │                                  │  ── Organization ──   │
│  ● other-proj    │                                  │  Tags  [bug] [+ add]  │
│                  │                                  │  Stack  Launch week ▾ │
│                  │                                  │  Group  Work          │
│                  │                                  │                       │
│                  │                                  │  [Resume]  [Archive]  │
└──────────────────┴─────────────────────────────────┴───────────────────────┘
```

---

## Implementation order

```
1a org.json infrastructure (withOrgLock, atomic write, SSE watcher, org-filters.ts)
  └→ 1b swoop.json tag extensions
       └→ 1c Session/Project model
            └→ 1d Org CRUD functions
                 └→ 1e Routes
                      └→ 1f Inspector: research/tool-health/freshness
                           └→ 2a Left rail + Inbox
                                ├→ 2b Focus bar
                                ├→ 2c Chips
                                ├→ 2d Tag picker (t)
                                └→ 2e Group/Stack picker (g)
                                     ├→ 2f Context menu additions
                                     ├→ 2g Inspector org editor
                                     └→ 2h Save as stack
                                          ├→ 3a TUI parity
                                          └→ 3b CLI filters
```

---

## Test strategy

| Layer                          | Approach                                            |
| ------------------------------ | --------------------------------------------------- |
| `org.json` write queue         | Unit: concurrent promises, verify serialization     |
| Org CRUD                       | Unit: temp dir, full create/update/delete cycle     |
| Tag validation                 | Unit: pure function, boundary cases                 |
| API routes                     | Integration: in-memory org + temp project dir       |
| Smart View / Inbox logic       | Unit: pure filter functions, no I/O                 |
| Focus filter                   | Unit: `filterByFocus(projects, focus)`              |
| Chip rendering                 | Unit: `buildTagChipsHtml(tags, max)` overflow       |
| Tag picker sort                | Unit: recent-first ordering                         |
| CLI filters                    | Integration: fixture project with known tags/groups |
| Web pickers (tag, group/stack) | Manual smoke test                                   |

---

## Effort estimate

| Phase          | Days        | What it unlocks                                 |
| -------------- | ----------- | ----------------------------------------------- |
| 1 — Foundation | 3           | Data layer, APIs, inspector completeness        |
| 2 — Web UI     | 4           | Full org UX: Inbox, rail, chips, pickers, focus |
| 3 — TUI + CLI  | 2           | Read/filter parity across all surfaces          |
| **MVP total**  | **~9 days** | Phases 1–3                                      |
| 4 — Advanced   | 3+          | After Phase 2 proven in use                     |

---

## Product guardrails

- No due dates, comments, assignments, or kanban boards
- Zero-config default must be immediately useful (Inbox works before any tag/group is created)
- Every feature must improve resume/triage speed, not just decorate rows
- TODOs and Plans are **read-only observed context** — never write back into Claude artifacts
- No AI auto-organization in the core path; heuristics opt-in only
- Prefer reversible local metadata; org data export/import is the safety net
- `prefs.json` is never written by org operations — clean separation always

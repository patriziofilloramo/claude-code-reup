# Cross-Device Project Memory

This document is the implementation reference for Reup's cross-device Claude
session storage. It describes the current behavior, the filesystem protocol,
the discovery and UI models, safety rules, known limitations, and the design
decisions behind them.

The feature is intentionally local-first. Reup does not upload sessions,
maintain a cloud account, or operate a remote coordination service. It places
Claude Code's per-project storage inside the project folder and relies on an
existing filesystem sync provider such as OneDrive, Dropbox, pCloud, Google
Drive, or iCloud to transport those files.

## 1. Goals and non-goals

### Goals

- Keep Claude session history physically close to the project that produced it.
- Let the user's existing cloud filesystem carry that history between devices.
- Require an explicit link on every device and for every project.
- Preserve local work if the cloud drive becomes temporarily unavailable.
- Make linked, unlinked-use, and offline states understandable in the UI.
- Avoid full-disk scans on startup.
- Keep the main project list relevant to the current device.

### Non-goals

- Reup is not a cloud storage provider.
- Reup does not notify other devices through a server or push channel.
- Reup does not create a global catalog file at the root of every cloud drive.
- Discovering a remote project does not automatically link it.
- Opening or resuming a project does not automatically opt the device into
  shared storage.
- The orange cloud is not a live presence or "currently active" indicator.
- `.claude-memory` is not intended to be committed to Git.

## 2. Terminology

| Term                   | Meaning                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Project root           | The actual code directory, for example `P:\Projects\Phone\Xiaomi17`.                                 |
| Local Claude directory | Claude Code's normal per-project storage at `~/.claude/projects/<project-id>`.                       |
| Project Memory         | The shared directory at `<project-root>/.claude-memory`.                                             |
| Linked device          | A device whose local Claude directory redirects to Project Memory.                                   |
| Unlinked use           | Evidence that a Claude session used the project on a device that was not linked.                     |
| Remote project         | Project Memory discovered on disk for a project this device has never used or linked.                |
| Cloud provider         | The external filesystem synchronization software. It transports files but is not controlled by Reup. |
| Online                 | The Project Memory directory can currently be enumerated.                                            |
| Offline                | A linked Project Memory target cannot currently be enumerated.                                       |

The word "cloud" in the UI describes where the project folder is transported.
The storage model itself is ordinary local filesystem I/O.

## 3. Filesystem layout

For a project at:

```text
P:\Projects\Phone\Xiaomi17
```

Claude Code normally stores sessions in an encoded directory similar to:

```text
~/.claude/projects/P--Projects-Phone-Xiaomi17/
```

After linking, the layout is:

```text
P:\Projects\Phone\Xiaomi17\
├── .claude-memory\
│   ├── <session-id>.jsonl
│   ├── sessions-index.json
│   ├── linked\
│   │   ├── DESKTOP-GF2E5L8
│   │   └── LAPTOP-EXAMPLE
│   ├── device-presence\
│   │   └── UNLINKED-PC.json
│   ├── sync-ignored\
│   │   └── IGNORED-PC
│   ├── memory\
│   │   └── shared.md
│   └── .reup-conflicts\
│       └── ... conflict artifacts when required
├── CLAUDE.md
└── project files...

~/.claude/projects/P--Projects-Phone-Xiaomi17
  -> P:\Projects\Phone\Xiaomi17\.claude-memory

~/.claude/reup/
├── device-id
├── prefs.json
└── sync/
    └── P--Projects-Phone-Xiaomi17/
        └── ... local offline backup
```

On Windows, the arrow is an NTFS directory junction. On macOS and Linux, it is
a directory symlink. Claude Code continues reading and writing its normal
`~/.claude/projects/<project-id>` path; the operating system redirects that I/O
to `.claude-memory`.

### Project ID encoding

Reup uses the same path-shaped directory convention as Claude Code:

- Windows drive paths become `<DRIVE>--<segments-separated-by-hyphens>`.
- Unix paths lose the leading slash and use hyphens between segments.
- On Windows, decoding is filesystem-aware because literal hyphens make the
  encoded representation ambiguous. Reup walks existing directories and
  prefers the longest matching real path segment.

If the local Claude directory does not exist yet, `reup sync link <path>`
computes the expected project ID and creates the link directly.

## 4. What makes a project linked

The current architecture is junction-first.

A project is linked on this device when its local Claude project directory is a
junction or symlink to Project Memory. During offline fallback, that link is
temporarily replaced by a real local directory; the in-process sync registry
then remains the authoritative record that the project is linked.

Link state is resolved in this order:

1. The runtime sync registry, when Reup has initialized cloud sync.
2. A junction or symlink at `~/.claude/projects/<project-id>`.
3. A legacy `.reup-link` file inside the local Claude directory.

`.reup-link` is retained only for migration from the older local-first sync
implementation. On initialization, Reup merges its local directory with the
recorded target and converts it to a junction/symlink. New links do not depend
on `.reup-link`.

The file `.claude-memory/linked/<device-id>` is separate from the filesystem
link. It is shared evidence that a named device intentionally performed the
link operation. It helps other devices and the Config UI understand the
multi-device state, but it does not itself redirect Claude Code storage.

## 5. Device identity and markers

Reup creates a persistent device ID at:

```text
~/.claude/reup/device-id
```

The initial value is the operating-system hostname. Persisting it prevents
normal application reinstalls from creating a new identity. Renaming a machine
does not automatically rewrite an existing device ID.

### Linked marker

```text
.claude-memory/linked/<device-id>
```

Created after the local filesystem link succeeds. Its JSON content currently
contains the device ID; the filename is the meaningful lookup key.

When this marker is written, Reup removes:

```text
.claude-memory/device-presence/<device-id>.json
```

This enforces the rule that a linked marker wins over stale unlinked-presence
evidence for the same device.

### Unlinked-use marker

```text
.claude-memory/device-presence/<device-id>.json
```

This means the device used the project while it was not linked and the user has
not dismissed the warning. It is durable unresolved evidence, not a heartbeat.
The marker may remain after that Claude process exits.

Reup itself does not infer this state from network activity. The managed
section in the project's `CLAUDE.md` instructs Claude Code to:

1. Read the hostname.
2. Check for `.claude-memory/linked/<hostname>`.
3. Check for `.claude-memory/sync-ignored/<hostname>`.
4. If neither exists, write the presence JSON and tell the user how to link or
   ignore the warning.

Because Claude Code's normal permission model still applies, the user may be
asked to approve the first marker write.

### Ignored marker

```text
.claude-memory/sync-ignored/<device-id>
```

This records that the user intentionally dismissed the unlinked-use warning on
that device. The managed instructions tell Claude Code to remove the device's
presence JSON when creating this marker.

### Marker precedence

For a single device:

1. A linked marker means linked, even if a stale presence file also exists.
2. An ignored marker suppresses creation of new presence evidence.
3. A presence marker without a linked marker means unresolved unlinked use.

Markers are transported by the cloud provider like every other file. There is
no separate Reup messaging channel between devices.

## 6. Feature enablement

The feature is enabled only when both controls are on:

```text
APP.enableProjectMemorySync === true
user preference crossDeviceSessionStorage === "on"
```

`APP.enableProjectMemorySync` is the application-level capability switch.
`crossDeviceSessionStorage` is the user's runtime preference and defaults to
`off`.

When the effective feature is off:

- Reup does not initialize the background cloud-sync guard.
- Config does not scan for remote Project Memory.
- Project discovery does not inspect Project Memory marker folders.
- TUI and web project lists render no cloud status icon.

Turning the feature off does not automatically unlink existing filesystem
junctions. The redirection is persistent filesystem state, so Claude Code may
still write through an already-existing junction. Use `reup sync unlink` when
the intent is to restore local-only storage.

## 7. Linking a project

The explicit operation is:

```bash
reup sync link <project-path>
```

The implementation performs these steps:

1. Resolve the absolute project path.
2. Load known projects and return early if it is already linked.
3. Refuse to change storage while a live Claude session is using that project.
4. Compute the Claude project ID if no local project record exists.
5. Create `<project-root>/.claude-memory` and its `memory` subdirectory.
6. Inspect the local Claude project directory.
7. Reconcile storage:
   - Existing junction to the same target: leave it in place.
   - Existing junction to another target: merge both targets, then repoint it.
   - Existing real directory: merge it with Project Memory, then replace it
     with a link.
   - No local directory: create the link.
8. Write `.claude-memory/linked/<device-id>`.
9. Remove the current device's stale presence marker.
10. Patch the bounded Reup section in `CLAUDE.md` by default.
11. Optionally patch `.gitignore` and Claude's local permission rules when
    requested by the caller.

All destructive-looking directory swaps are staged. When a real directory is
replaced with a link, the original is first renamed to a rollback path. If link
creation fails, the original directory is restored.

### Why active projects cannot be linked or unlinked

Changing the storage path while Claude Code has a live session could split
writes between two directories or replace a directory underneath an open
writer. Reup checks live session records and blocks the operation. Bulk
operations report these projects as skipped rather than forcing the change.

## 8. Unlinking a project

The explicit operation is:

```bash
reup sync unlink <project-path>
```

Reup:

1. Confirms that the project is linked.
2. Refuses the operation while a live session uses the project.
3. Copies the complete shared target into a staged local directory.
4. Removes the junction/symlink only after staging succeeds.
5. Moves the staged directory into Claude Code's normal local location.
6. Removes the current device's linked marker.
7. Removes the bounded Reup section from the project's `CLAUDE.md`.

Unlinking does not delete `.claude-memory`. Other linked devices may still use
it, and it remains recoverable data in the project folder.

Current limitation: `CLAUDE.md` belongs to the shared project tree, so removing
its managed section on one device is also transported to other devices by the
cloud provider. The per-device linked markers remain authoritative, but other
devices may lose the automatic unlinked-use protocol until a later link action
reinstalls the section.

### Forgetting the local project

After unlinking, an eligible project can be forgotten on the current device.
This is intentionally different from unlinking:

- Unlink restores ordinary local Claude storage and keeps the project locally
  visible.
- Forget removes that local Claude index entry from active discovery.
- `.claude-memory` is never deleted or modified by forget.
- The local directory is moved, not deleted, to
  `~/.claude/reup/forgotten/<project-id>/<timestamp>/project-data`.
- A manifest beside the archive records the project ID, project path, shared
  path, and archive time.

Forget is available only when the project is locally known, unlinked, inactive,
and has reachable Project Memory. A linked project must be unlinked first. A
purely local project cannot be forgotten through this feature because there is
no shared copy from which it can later be rediscovered.

After the operation, the project disappears from the main project list and may
reappear under Remote Project Memory in Config. Linking it again recreates the
local redirect. The archived local copy remains available for manual recovery.

## 9. Managed project files

### `CLAUDE.md`

Reup edits only the bounded region between:

```html
<!-- reup:sync:start -->
...
<!-- reup:sync:end -->
```

Existing project instructions outside those markers are preserved. Re-linking
replaces the existing bounded section instead of appending duplicates.

The section explains the device marker protocol and instructs Claude to append
only important shared context to:

```text
.claude-memory/memory/shared.md
```

It explicitly says not to copy prompts or transcript content into that note.
Session transcripts already live in `.claude-memory`.

### `.gitignore`

If requested, Reup adds exactly:

```gitignore
.claude-memory/
```

It preserves existing content and does not duplicate an equivalent entry. This
patch is optional in the current link flow and is not enabled by default.

### `.claude/settings.local.json`

If requested, Reup merges narrowly scoped allow rules for:

- Reading `.claude-memory/**`.
- Writing `device-presence/**`.
- Writing `sync-ignored/**`.
- Editing `memory/shared.md`.

The patch is optional and is not enabled by default. Malformed JSON or an
unexpected `permissions.allow` type causes a clear setup error rather than
overwriting the file.

## 10. Main project discovery

The main Reup project list is deliberately local-device scoped.

`loadProjects()` starts from entries already present under:

```text
~/.claude/projects/
```

This includes real directories and junctions/symlinks. It does not scan cloud
drives to inject every remote Project Memory into the home screen.

A discovered local project is retained when it has at least one of:

- A session.
- A linked/shared storage state.
- An offline shared state.

This means:

- A project used by Claude on this device appears normally.
- An explicitly linked project remains visible even before it has sessions.
- A remote-only project does not appear merely because its folder exists in a
  cloud drive.

When sync is enabled, local project discovery also checks:

```text
<project-root>/.claude-memory
```

That direct check allows a locally used but unlinked project to see linked and
unlinked device markers without performing broad cloud discovery. This is why a
local-only project can legitimately show an orange cloud.

### Link-state priority during discovery

The loader determines whether the current device is linked from:

1. The runtime sync registry.
2. The local directory's junction/symlink state.
3. A legacy `.reup-link` file.

It then reads Project Memory markers, filters presence entries that also have a
linked marker, and attaches the resulting state to the `Project` model.

### Caching

Project discovery has a two-second in-process cache for bursts of related UI or
API requests. The cache key includes the effective sync-enabled state, so
toggling the preference cannot reuse a result from the other mode. Filesystem
events and sync transitions invalidate the cache.

## 11. Remote discovery in Config

The Config sync view intentionally has a broader scope than the main project
list. `buildSyncOverview()` combines:

1. Locally known projects from `loadProjects()`.
2. Remote Project Memory discovered under allowed search roots.

The remote scan runs when the user enters the Features tab or explicitly
refreshes the sync overview. The UI displays a spinner while this work runs.
Remote results are link candidates; they are not inserted into the home project
list.

### What counts as remote Project Memory

A directory is recognized when `<candidate>/.claude-memory` exists and contains
at least one of:

- A linked-device marker.
- An unlinked-use presence marker.
- A root-level session transcript named as a UUID `.jsonl` file.

Transcripts matter because older or partially migrated Project Memory may
predate device markers. An empty `.claude-memory` directory alone is not enough
evidence.

The scanner keeps `linkedDevices` and `unlinkedDevices` separate and removes
unlinked entries whose device also has a linked marker.

### Default focused discovery

With `APP.enableAdvancedDiscovery === false`, Reup detects known provider roots
and looks for common workspace directories:

```text
Projects, Code, Workspace, Work, Repos, Dev
```

If one or more of those directories exist under a provider root, only those
focused roots are scanned. If none exist, the provider root itself is used as a
fallback. Scanning is recursive to a maximum depth of four, with filesystem
operations limited to 32 concurrent tasks.

The scanner skips:

- Hidden directories.
- `.claude-memory`.
- `.git`.
- `node_modules`.
- Common output or dependency trees such as `build`, `dist`, `out`, `target`,
  and `vendor`.
- Symlinked directories, to avoid loops and unrelated redirected trees.

Known local project paths are not emitted as remote candidates, but their child
directories are still scanned. A known parent must not hide a nested project.

### Advanced discovery

With:

```ts
APP.enableAdvancedDiscovery = true
APP.projectSearchPaths = ['~/Documents/Projects']
```

Reup does a full scan only inside the explicitly configured paths. It does not
combine them with detected cloud roots. The same depth, ignore, and concurrency
rules still apply.

Advanced discovery is opt-in because recursive filesystem crawling can dominate
startup or Config loading time on large drives. It is intended for uncommon
layouts that focused provider discovery cannot reach.

### Provider-root detection

Current detection understands:

- OneDrive environment variables.
- Dropbox's local `info.json`.
- Common pCloud mount locations, including `P:\` on Windows.
- Common Google Drive locations.
- Platform-specific iCloud Drive locations.

Detection only identifies local filesystem roots. It does not call provider
APIs or verify provider account state.

## 12. Config categories

The Features panel groups the sync overview into three intentionally different
sets:

### Synced Project Memory

Projects linked on this device. Their local Claude directory redirects to
`.claude-memory`, or the runtime registry is holding their linked state during
offline fallback.

### Local-Only Projects

Projects known on this device but not linked here. They may:

- Be outside a detected cloud root.
- Be inside a cloud root but not linked.
- Have Project Memory created by another device.
- Have unresolved unlinked-use evidence and therefore show orange in the main
  project list.

An active local-only project remains visible but linking is disabled until its
live Claude session ends.

### Remote Project Memory

Project Memory found by Config discovery for a project that this device has
never used or explicitly linked. These entries are intentionally absent from
the main Reup project list.

Remote discovery is an inventory for possible linking, not an assertion that
the project belongs in this device's daily workspace.

## 13. Cloud icon state model

All project-list icons use one shared status helper. Rendering does not perform
filesystem I/O.

| Effective feature | Local state            | Shared path       | Unlinked markers               | Result                                                        |
| ----------------- | ---------------------- | ----------------- | ------------------------------ | ------------------------------------------------------------- |
| Off               | Any                    | Any               | Any                            | No icon                                                       |
| On                | Local-only             | No Project Memory | None                           | No icon                                                       |
| On                | Linked here            | Unreachable       | Any                            | Grey cloud                                                    |
| On                | Linked or locally used | Reachable         | One or more unresolved devices | Orange cloud                                                  |
| On                | Linked here            | Reachable         | None                           | Green cloud                                                   |
| On                | Remote-only discovery  | Reachable         | Any                            | No home-list icon because the project is not on the home list |

Priority is:

1. Feature disabled: hide the icon.
2. No shared-memory evidence: no icon.
3. Shared target offline: grey.
4. Unresolved unlinked-use markers: orange.
5. Linked here and reachable: green.
6. Otherwise: no icon.

### Green

The current device is linked and Project Memory is reachable. It does not
promise that the external provider has already uploaded every byte to every
other device.

### Orange

At least one unresolved `device-presence` marker exists. Orange means "a device
used this shared project without linking and has not resolved or ignored that
state."

It does not mean:

- The other device is online.
- The other device is currently running Claude.
- Synchronization is actively transferring.
- Every device except this one is linked.

A device can see orange while itself remaining local-only. This is useful:
Project Memory exists, the project is locally relevant, and the shared marker
records a mismatch that deserves attention.

### Grey

The current device is linked, but Reup cannot enumerate the shared target.
When a local backup exists and no session is active, the offline guard replaces
the broken link with that backup so work can continue.

## 14. Background online/offline guard

When the TUI or web server starts, `initCloudSync()`:

1. Stops any previous interval and clears runtime state.
2. Returns immediately if the effective feature is disabled.
3. Loads locally known projects.
4. Initializes only projects linked on this device.
5. Migrates legacy `.reup-link` directories when safe.
6. Creates or refreshes each project's local backup.
7. Starts a periodic guard when at least one project is managed.

The default interval is 30 seconds.

The runtime registry maps each local Claude project path to:

- The shared target.
- Whether it is online.
- Whether local offline work still needs merging.

This registry is necessary because offline mode temporarily replaces the
junction with a normal directory. Filesystem inspection alone would otherwise
misclassify that project as local-only.

### Reachability check

Reup probes the shared directory with `readdir`, not only `access`. Some
virtual drives report successful access even while the mounted content cannot
actually be enumerated.

### Going offline

If a previously online target becomes unreachable:

1. Reup checks for a live Claude session in that project.
2. If active, it defers the transition.
3. If inactive, it copies the local backup into a staged directory.
4. It removes the junction.
5. It moves the staged real directory into Claude's local project path.
6. It marks the state offline with a pending merge.

If no backup exists during initial startup, Reup leaves the broken junction in
place because it has no safe data source from which to construct a local copy.

### Coming back online

If an offline target becomes reachable:

1. Reup defers while a Claude session is active.
2. It performs a bidirectional merge between the offline local directory and
   Project Memory.
3. It mirrors the converged shared directory into the backup.
4. It replaces the local real directory with the junction/symlink again.
5. It clears the pending-merge state.

When already online, the periodic cycle mirrors Project Memory to the backup.
This also picks up changes delivered by the cloud provider from other devices.

## 15. Merge and conflict behavior

Both linking and online recovery may need to reconcile two directory trees.
Reup recursively applies these rules:

1. A file present on only one side is copied to the other side.
2. Matching directories are traversed recursively.
3. A directory present on only one side is created and copied.
4. Symlinks and junctions inside the trees are skipped during bidirectional
   sync; their targets are expected to be managed separately.
5. A file-versus-directory mismatch is a structural conflict.
6. Identical files require no action.
7. If one file is an exact byte prefix of the other, the longer copy wins.
8. Divergent UTF-8 Markdown files are union-merged by unique line.
9. Other divergent files preserve both originals as conflict artifacts before
   one deterministic canonical copy is propagated.

### Why prefix comparison

Claude JSONL transcripts are normally append-only. If copy B is an exact prefix
of copy A, A is provably the same history with additional events. Propagating A
does not discard an independent branch.

### Markdown union merge

For `.md` files, lines present only on the second side are appended to the first
side, then the merged result is copied to both sides. This supports the common
case where devices independently append entries to a shared memory note.

This is a line-set merge, not a semantic Markdown merge. Reordered or edited
lines may produce an imperfect document even though content is retained.

### Divergent non-Markdown files

Before convergence, Reup writes into `.reup-conflicts` on both sides:

- The complete side-A content.
- The complete side-B content.
- A JSON manifest containing paths, byte counts, modification times, SHA-256
  hashes, detected JSONL timestamps, and the chosen resolution.

The canonical side is selected by:

1. Latest valid event timestamp found in JSONL content.
2. The only side with a valid JSONL timestamp.
3. Latest filesystem modification time.
4. Stable path ordering as a deterministic tie-breaker.

The conflict copies make the discarded branch recoverable even after both
working paths converge.

### Backup mirroring is directional

The online backup refresh mirrors shared storage to the backup. Files missing
from the source are removed from the backup. The backup is an offline fallback,
not an independent archival history.

## 16. Data flow between devices

For two linked devices, the normal path is:

```text
Claude on device A
  -> ~/.claude/projects/<id> junction
  -> project/.claude-memory
  -> cloud provider
  -> project/.claude-memory on device B
  -> ~/.claude/projects/<id> junction
  -> Claude or Reup on device B
```

Reup does not need to run continuously on the receiving device for the cloud
provider to deliver files. Reup is needed there to create the local link,
display status, manage backups, and recover across offline transitions.

### How another device learns about a new project

There is no push notification and no root-level catalog. The other device can
learn about Project Memory in two ways:

1. It already used the project, so normal local discovery directly inspects
   `<project-root>/.claude-memory`.
2. The user opens Config > Features, where focused or advanced discovery scans
   allowed roots and lists it under Remote Project Memory.

This is a deliberate privacy and scope tradeoff. Reup does not write indexing
files into every cloud provider root merely to announce projects.

## 17. Design decisions and tradeoffs

### Project-root storage instead of a Reup cloud database

Keeping memory under the project root aligns session transport with the code
folder the user already chose to synchronize. Moving or excluding the project
also moves or excludes its memory.

Tradeoff: Reup inherits the behavior, delays, conflicts, and availability of
the external provider.

### Explicit per-device linking

Linking changes where Claude Code writes important data. It must be an explicit
operation, not a side effect of opening, resuming, or discovering a project.

Tradeoff: the user performs one setup action on each device.

### Main list local; Config inventory broader

The home screen answers "what projects matter on this device?" Config answers
"what Project Memory could this device link?" Combining those questions made
remote cloud folders pollute the normal project list.

### Presence markers instead of real-time presence

Durable marker files work through ordinary cloud storage and require no service.
They communicate an unresolved configuration mismatch.

Tradeoff: orange is not live state and requires explicit resolution or ignore.

### No cloud-root catalog

A root catalog would make discovery faster and could notify other Reup
instances where to look, but it would write Reup metadata into every provider
root and introduce catalog consistency problems. The current design scans only
when needed and only within bounded roots.

### Focused discovery by default

Provider roots may contain millions of files. Scanning common workspace
directories is fast enough for interactive Config use and avoids a full-drive
crawl.

Tradeoff: unusual layouts require explicit advanced search paths.

### Junction-first direct writes

Direct redirection avoids a second synchronization daemon in the normal online
case. Claude writes once and the provider transports the result.

Tradeoff: losing the mounted target requires careful link replacement and a
maintained backup.

### Runtime registry during offline fallback

The actual filesystem node becomes a normal directory while offline, but the
logical project remains linked. Keeping this transient truth in a small shared
registry avoids circular dependencies and incorrect icons.

## 18. Failure modes and recovery

### Project is missing from the home list

Expected when the project has never been used or linked on this device. Look in
Config > Features > Remote Project Memory. If it is also missing there:

- Confirm the project folder is available locally.
- Confirm `.claude-memory` contains a transcript or device marker.
- Confirm the folder is within focused discovery roots.
- Configure an explicit advanced search path for an uncommon layout.

### Orange cloud remains after linking

Check for stale presence files from other devices. Linking removes only the
current device's presence file. Orange remains while any unresolved unlinked
device marker exists.

### Green cloud does not appear

- Confirm both feature switches are enabled.
- Confirm this device's local Claude directory is a junction/symlink.
- Confirm `.claude-memory/linked/<this-device-id>` exists.
- Confirm the shared path is reachable.
- Allow the short project cache to expire or trigger a refresh.

### Grey cloud appears

The linked target is not enumerable. Check the provider mount and network. If a
backup exists, Reup transitions to local offline mode when the project is not
active, then merges and restores the link after recovery.

### Link or unlink is unavailable

A live Claude session is using the project. End that session before changing
storage topology.

### The project contains conflict artifacts

Inspect `.reup-conflicts/*.json` first. The manifest identifies both preserved
copies and why one became canonical. Do not delete the artifacts until the
desired content has been verified.

### Device name changed

The persistent `~/.claude/reup/device-id` may still contain the old hostname.
Markers use that stored value. Changing device identity manually requires
cleaning or reconciling old linked, presence, and ignored markers.

### Feature was disabled but sessions still reach Project Memory

Disabling hides and suspends Reup's feature behavior; it does not remove an
existing filesystem junction. Explicitly unlink the project.

## 19. Security and privacy

`.claude-memory` contains full Claude session transcripts and may contain
project-specific shared notes. Treat it with the same sensitivity as source
code, credentials accidentally pasted into a session, and local development
history.

- Verify the cloud provider's encryption, account security, and sharing scope.
- Keep `.claude-memory/` out of Git unless committing transcripts is an
  intentional choice.
- Review shared-folder permissions before linking a confidential project.
- Remember that provider retention and version history are outside Reup's
  control.
- The optional Claude permission rules are narrowly scoped, but the normal
  Claude Code approval model remains authoritative.

Reup's web server is local, and this feature does not add a remote Reup API.
The external provider still receives every file placed in the synchronized
project folder.

## 20. Configuration reference

| Setting                                     | Default          | Purpose                                                                    |
| ------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `APP.enableProjectMemorySync`               | `true`           | Application-level master capability switch.                                |
| User preference `crossDeviceSessionStorage` | `off`            | User-facing feature toggle.                                                |
| `APP.enableAdvancedDiscovery`               | `false`          | Use explicit recursive search paths instead of focused provider discovery. |
| `APP.projectSearchPaths`                    | `[]`             | Roots used only in advanced discovery mode.                                |
| `APP.sharedMemoryDir`                       | `.claude-memory` | Shared directory name inside each project.                                 |
| `APP.cloudLinkFile`                         | `.reup-link`     | Legacy link marker retained for migration.                                 |
| `APP.cloudSyncIntervalMs`                   | `30000`          | Online/offline guard and backup refresh interval.                          |
| `APP.cloudSyncBackupDir`                    | `sync`           | Backup directory below `~/.claude/reup`.                                   |

## 21. Implementation map

| Concern                                   | Source                                     |
| ----------------------------------------- | ------------------------------------------ |
| Runtime configuration                     | `src/config/app.ts`                        |
| User preference                           | `src/core/user-prefs.ts`                   |
| Path encoding and Claude directories      | `src/core/project/claude-paths.ts`         |
| Main local project discovery              | `src/core/project/project-discovery.ts`    |
| Focused and advanced remote discovery     | `src/core/sync/cloud-project-discovery.ts` |
| Link, unlink, markers, and managed files  | `src/core/sync/sync-actions.ts`            |
| Junctions, backup guard, merge, conflicts | `src/core/sync/cloud-sync.ts`              |
| Persistent device ID                      | `src/core/sync/device-id.ts`               |
| Runtime offline state                     | `src/core/sync/sync-registry.ts`           |
| Shared icon status derivation             | `src/core/sync/project-sync-status.ts`     |
| Config TUI                                | `src/tui/ConfigApp.tsx`                    |
| Main TUI project icon                     | `src/tui/components/ProjectList.tsx`       |
| Web API serialization                     | `src/web/api-model.ts`                     |
| Web project icon                          | `src/web/client/05-projects.js`            |

## 22. Core invariants

Future changes should preserve these rules:

1. Linking is explicit and blocked while the project is active.
2. Forget is restricted to inactive, unlinked projects with reachable Project
   Memory and archives local data instead of deleting it.
3. The main project list never imports remote-only discovery results.
4. Config may show a broader remote inventory.
5. A linked marker overrides stale presence for the same device.
6. Orange represents unresolved unlinked use, not real-time activity.
7. The master switch and user preference both gate icons and active Reup sync
   behavior.
8. Disabling the feature does not silently alter persistent filesystem links.
9. Broad discovery remains opt-in and bounded by explicit search paths.
10. Directory swaps retain rollback or staged copies until the replacement
    succeeds.
11. Divergent content is preserved before convergence.
12. Offline/online topology changes are deferred while Claude is actively
    writing to the project.
13. Cloud provider behavior is never presented as a guarantee made by Reup.

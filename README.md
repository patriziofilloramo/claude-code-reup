# Reup

**Remember the work, not where you started it.**

Reup brings your local Claude Code CLI work into one persistent view across
projects and ordinary terminal sessions. Find the task you remember, see what
needs you, and resume with the latest request, answer, write/edit targets, path,
and branch in view.

[![Reup web dashboard showing three local projects, session states, and a pre-resume context card](https://raw.githubusercontent.com/patriziofilloramo/claude-code-reup/main/docs/assets/screenshot-web-dashboard.png)](https://github.com/patriziofilloramo/claude-code-reup/blob/main/docs/assets/screenshot-web-dashboard.png)

_The screenshot is the actual web app rendered from deterministic synthetic
session data; it contains no maintainer transcript or account data._

Reup is built for developers who use Claude Code every day across enough
repositories and terminals that “which directory was that in?” has become a
real interruption.

## The workflow

### 1. Find the work

Search every discovered local project from one place. Start with titles,
aliases, branches, and paths; switch to transcript search when the detail you
remember is buried in the conversation; or ask which sessions touched a file.

### 2. Know what needs you

Scan live processes and locally anchored background tasks without visiting
every terminal. Reup prefers Claude Code's documented Agent View inventory
when available and uses bounded local lock, hook, and transcript fallbacks when
reported fields are unavailable.

### 3. Resume in context

Open a resume card before launching Claude Code. Reup surfaces the latest human
request and assistant answer, plans and TODOs when recorded, write/edit targets,
the recorded working directory, branch drift, missing paths, interruption
signals, and context pressure.

Illustrative composite of the TUI and web dashboard (not literal command
output):

```text
40 sessions · 9 projects

needs input   auth migration       apps/api       permission prompt
working       release checks       tools/reup     running tests
attached      docs refresh         site           18m ago

select → inspect request / answer / branch → resume in the right directory
```

## Reup and Claude Code's built-in views

Reup complements Claude Code rather than replacing its native session tools.

| Tool                   | Best at                                                                                           | Boundary                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Claude Code `/resume`  | Switching to a saved conversation, with preview, branch and global search via `Ctrl+A`            | A picker inside the resume flow; selecting an unrelated project copies a `cd … && claude --resume …` command  |
| Claude Code Agent View | Dispatching, watching, replying to, and attaching to background sessions                          | Regular interactive sessions in other terminals do not appear until they are backgrounded                     |
| Reup                   | Finding and triaging local history and matched work together, then checking context before resume | Focused on local Claude Code CLI data; it does not aggregate Claude desktop, web, or remote session histories |

See Claude Code's official documentation for
[`/resume`](https://code.claude.com/docs/en/sessions) and
[Agent View](https://code.claude.com/docs/en/agent-view). Native behavior can
change as Claude Code evolves.

## Try the current beta

Reup is not published to npm yet and the repository currently has no tagged
public release. The source beta requires Node.js 20+ and the Claude Code CLI.
These commands install the Reup CLI and local web dashboard; the VS Code
extension is packaged separately.

```bash
git clone https://github.com/patriziofilloramo/claude-code-reup.git reup
cd reup
npm ci
npm run build
npm link
reup
```

Release-candidate artifacts will appear on
[GitHub Releases](https://github.com/patriziofilloramo/claude-code-reup/releases)
when published. Until the release page says otherwise, treat Windows and macOS
artifacts as unsigned and macOS artifacts as not notarized; verify the published
SHA-256 checksums before installation.

On the first `reup`, `reup web`, or `reup config` launch, Reup registers local
Claude Code hooks for turn boundaries and reports the change together with the
undo command. Remove integrations before unlinking the source beta:

```bash
reup attention remove
reup usage remove # only if usage setup was enabled
npm unlink --global @patriziofilloramo/reup
```

## Core commands

| Command                      | Outcome                                              |
| ---------------------------- | ---------------------------------------------------- |
| `reup`                       | Open the keyboard-first terminal view                |
| `reup web`                   | Keep a local dashboard open at `127.0.0.1`           |
| `reup inbox`                 | List active and attention-worthy sessions            |
| `reup resume [session]`      | Pick globally or resume by ID/prefix                 |
| `reup search <query>`        | Search local session metadata                        |
| `reup search --deep <query>` | Search transcript content on demand                  |
| `reup touched [path]`        | Find sessions whose Edit/Write calls targeted a file |
| `reup handoff [session]`     | Produce a compact continuation packet                |

Additional maintenance and automation commands:

| Command                   | Outcome                                          |
| ------------------------- | ------------------------------------------------ |
| `reup list [query]`       | Print a scriptable session list                  |
| `reup usage`              | Show observed usage with freshness               |
| `reup attention [action]` | Manage local attention alerts                    |
| `reup cleanup`            | Review candidates for reversible local archiving |
| `reup doctor`             | Diagnose local Claude Code session data          |
| `reup config`             | Open configuration                               |
| `reup completion <shell>` | Print PowerShell, Bash, or Zsh completion setup  |
| `reup help [command]`     | Show command help                                |

`reup list`, `reup resume`, and `reup handoff` accept globally unambiguous
session ID prefixes with a minimum length of eight characters.

## Interfaces

- **Terminal UI** — the default, keyboard-first path for finding, inspecting,
  and resuming work quickly.
- **Local web dashboard** — an always-open view with live updates, project and
  session organization, and an inspector. Run `reup web` or choose another port
  with `reup web --port 4000`.
- **VS Code extension** — a local workspace view, full dashboard, and session
  inspector. Resume through the Claude Code extension when available or through
  the integrated terminal.
- **CLI output** — concise human output and JSON where supported for scripts and
  automation.

These are interfaces over local Reup discovery; they are not a sync service.

## Signal accuracy and limits

Session labels are evidence-based. When supported, Reup uses fields reported by
Claude Code's documented Agent View inventory for the specific state they
describe. Missing fields do not erase valid lock or hook evidence. Transcript
analysis is a time-bounded fallback. Current surfaces do not show provenance on
every row, so activity without an explicit wait reason remains best-effort
rather than a guarantee.

`claude agents --json` can retain background tasks reported as `working` or
`blocked` after their process exits. Reup keeps those managed rows as
conservative safety evidence, but presents a row without a PID only when it
maps to a resume-visible discovered session or a verified live lock. Hook and
work markers can refine state but cannot anchor a row because they can be
orphaned. Only a reported PID or verified lock establishes a live process;
session age is not used to expire managed state.

That distinction matters for permission prompts: current Claude Code versions
can report a documented `waitingFor` reason for managed sessions, including a
permission prompt. Older versions, an unavailable Agent View inventory, or
sessions that cannot be matched may not expose that reason, so Reup must not
guarantee that every permission wait will be identified.

Resume and health signals are guidance, not a guarantee that a session is safe
or complete. Claude Code's local transcript format is not a stable public API
and can change between releases.

## Local data and safety

By default, Claude Code owns local transcripts under:

```text
~/.claude/projects/
```

Reup stores user-level preferences, caches, and Reup-owned metadata under:

```text
~/.claude/reup/
~/.claude/projects/<project-id>/reup.json
```

Reup reads Claude-owned transcript data and does not rewrite it during normal
discovery or archiving. **Archive** only hides a session through Reup-owned
metadata and is reversible. **Delete permanently** is a separate, explicit,
confirmed action in the TUI and web dashboard; it removes the transcript, is
blocked for active sessions, and cannot be undone.

Reup performs transcript analysis locally, sends no Reup telemetry, requires no
Reup account or hosted backend, and binds its web server to `127.0.0.1`.

The first TUI/web/config launch adds reversible Reup attention hooks to Claude
Code settings and announces the exact removal command. Account-limit refresh is
off until `reup usage setup`; after that explicit setup, Reup reads Claude
Code's OAuth token in memory to call Anthropic's account-usage endpoint and
stores aggregate results only. `reup usage remove` restores the prior status
line and deletes the cache.

It does not move transcript storage, synchronize sessions between machines, or
combine local CLI history with Claude Code's desktop, web, or remote histories.
Review handoff packets before sharing them, and keep backups of important
projects and transcripts.

See [Disclaimer](https://github.com/patriziofilloramo/claude-code-reup/blob/main/DISCLAIMER.md),
[Privacy](https://github.com/patriziofilloramo/claude-code-reup/blob/main/PRIVACY.md),
[Security](https://github.com/patriziofilloramo/claude-code-reup/blob/main/SECURITY.md),
and [Support](https://github.com/patriziofilloramo/claude-code-reup/blob/main/SUPPORT.md).

## Shell completion

Completion is opt-in and prints exact session IDs only.

PowerShell:

```powershell
reup completion powershell | Out-String | Invoke-Expression
```

Bash:

```bash
source <(reup completion bash)
```

Zsh:

```bash
source <(reup completion zsh)
```

Append the generated output to your shell profile to enable completion in new
terminals.

## Development

```bash
npm ci
npm run build:client
npm run build
npm run build:extension
npm test
npm run lint
npm run format:check
```

Create local release-candidate artifacts without publishing:

```bash
npm run release:local
npm run release:installers
```

Reference documents:

- [Contributing](https://github.com/patriziofilloramo/claude-code-reup/blob/main/CONTRIBUTING.md)
- [Architecture](https://github.com/patriziofilloramo/claude-code-reup/blob/main/Documents/ARCHITECTURE.md)
- [Feature catalog](https://github.com/patriziofilloramo/claude-code-reup/blob/main/Documents/FEATURES.md)
- [Installation and distribution](https://github.com/patriziofilloramo/claude-code-reup/blob/main/Documents/INSTALLATION.md)
- [Product direction](https://github.com/patriziofilloramo/claude-code-reup/blob/main/Documents/PRODUCT_DIRECTION.md)
- [Usage visibility](https://github.com/patriziofilloramo/claude-code-reup/blob/main/Documents/USAGE_VISIBILITY.md)
- [VS Code extension](https://github.com/patriziofilloramo/claude-code-reup/blob/main/extension/README.md)
- [Roadmap](https://github.com/patriziofilloramo/claude-code-reup/blob/main/ROADMAP.md)

## Disclaimer

Reup is an independent open-source project. It is not affiliated with,
endorsed by, or maintained by Anthropic. Claude and Claude Code are trademarks
of Anthropic.

Reup is provided as-is, without warranty or SLA.

## License

[MIT](https://github.com/patriziofilloramo/claude-code-reup/blob/main/LICENSE)

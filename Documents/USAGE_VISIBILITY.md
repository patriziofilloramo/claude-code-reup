# Usage Visibility

This document defines how Reup presents Claude Code usage without guessing while
keeping authenticated access explicit, minimal, and local-first.

## Product Rule

Every value must make its scope and freshness obvious:

- **Session context** is a local fact from the latest observed transcript event.
- **Live plan limits** are account-level facts from a supported Claude Code
  integration.
- Missing data remains unavailable. Reup never turns an absent value into zero.

## Source Matrix

| Source                                                                | Supported facts                                                             | Trust and limitations                                                                     | Reup use                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Local session transcripts                                             | Model IDs and latest input/cache/output token counts                        | Historical local snapshot; unavailable on the index fast path                             | Implemented                                       |
| Claude account usage endpoint                                         | Current 5-hour and 7-day percentages/reset times; usage-credit enabled flag | Authenticated internal endpoint used by Claude Code; not a documented public API          | Primary opt-in account-limit source               |
| [Claude Code status line](https://code.claude.com/docs/en/statusline) | Current model/agent, context percentage, and occasional account limits      | Supported session source; fields may be absent and are only emitted after an API response | Session details and account-limit fallback        |
| [Claude Code hooks](https://code.claude.com/docs/en/hooks)            | Prompt submission, stop, and needs-input notifications                      | Reup-owned attention hooks are announced, reversible, and respect a recorded opt-out      | Implemented turn-boundary fallback                |
| [`/usage`](https://code.claude.com/docs/en/costs)                     | Interactive plan usage, activity, and cost information                      | Human-facing command with no documented machine-readable invocation                       | Never run automatically                           |
| [OpenTelemetry](https://code.claude.com/docs/en/monitoring-usage)     | Detailed token, model, cost, and agent telemetry                            | Powerful but opt-in and substantially heavier than Reup's default design                  | Optional future integration only                  |
| Claude account Usage page                                             | Credits, billing period, and feature allowances                             | No documented local or public personal-account API                                        | Show only if Anthropic exposes a supported source |
| Claude Code local application state                                   | Whether usage credits are currently enabled                                 | Internal best-effort cache; field may disappear or change without notice                  | Positive `credits on` badge only                  |

## Implemented: Transcript Context

Reup extracts these facts while it already scans a transcript:

- `latestModel`: latest observed Claude model ID
- `models`: distinct Claude model IDs in first-seen order
- `latestContextTokens`: latest input, cache-creation, and cache-read token total
- `latestOutputTokens`: output tokens from the same latest observed response

`latestContextTokens` follows Claude Code's documented context-percentage
semantics and intentionally excludes output tokens. The values describe the
latest response recorded on disk; they are not claimed to be live account usage.

When Reup uses `sessions-index.json` without opening a transcript, all context
metrics are `null`.

## Implemented: Live Account Limits

After explicit setup, Reup refreshes the same read-only account usage endpoint
used by Claude Code. The integration is explicit and reversible:

```text
reup usage setup
reup usage setup --replace
reup usage remove
```

Setup refuses an existing status line unless `--replace` is supplied. Replacement
saves the exact previous value; removal restores it. If the status line changes
after Reup setup, removal refuses to overwrite the newer user configuration.

Reup reads Claude Code's local OAuth access token only while making the request.
It never logs, returns, or copies the token into Reup storage. Successful
responses are reduced to aggregate limit percentages, reset times, the
usage-credit enabled flag, and a fetch timestamp in
`~/.claude/reup/account-usage.json`.

Web and TUI poll locally every five seconds. The authenticated account request
is rate-limited to once every 30 seconds and has a five-second timeout. A recent
cached response may be shown as cached for up to 15 minutes if a refresh fails.

The status-line integration remains the source for model, agent, and context
details. Its occasional rate-limit fields are used only as a clearly labelled
fallback when the account request is unavailable.

Claude for VS Code does not currently execute the terminal status-line
integration. Reup therefore never claims that a cached value is live merely
because a VS Code session is active. Collector failures are stored as one
privacy-safe diagnostic containing only timestamp and error message.

Stored fields are limited to:

- capture timestamp and session ID
- model ID/display name and agent name
- context used/remaining percentage and context-window size
- 5-hour and 7-day used percentage and reset time

Credit spending, monthly periods, and routine-run allowances remain unavailable
until a supported source exposes them. Reup may show a positive `credits on`
badge when Claude Code's adjacent local application-state cache explicitly
reports usage credits enabled. Missing or changed internal state remains
unknown; Reup never infers activation from cost or rate-limit data.

## Safety And Privacy

- Read Claude's OAuth access token only after explicit `reup usage setup`, keep it
  in memory only for the authenticated read-only request, and never log or cache it.
- Never read browser cookies.
- Never invoke Claude merely to refresh usage; that would consume usage.
- Never enable telemetry. Reup's attention hooks may be registered or repaired
  automatically on first TUI, web, or configuration launch, but the write is
  announced, reversible with `reup attention remove`, and not repeated after
  the user opts out.
- Never retain prompt, response, or tool content in a usage cache.
- Never retain transcript paths, session names, cost data, or credentials.
- Read only the usage-credit-enabled boolean from Claude Code application state; never retain it.
- Keep all captured values on the user's machine.
- `reup usage remove` deletes captured session snapshots and the aggregate account cache.

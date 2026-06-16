# Swoop VS Code Extension

Local preview extension for Swoop's editor-native workflow.

## What Works

- `Swoop: Diagnostics` logs project/session counts to the Swoop Output Channel.
- `Swoop: Resume Session` opens a global Quick Pick backed by Swoop core data.
- `Swoop: Resume Here` ranks sessions for the current workspace first.
- `Swoop: Open Resume Card` opens a read-only Markdown summary for a session.
- The Swoop Activity Bar view shows a read-only project/session tree.
- Clicking a session in the tree opens its Resume Card; context actions still
  provide Resume / Copy ID.
- `swoop.refreshMode` can keep the tree manual, filesystem-watched, or refreshed
  every 20 seconds.
- Session resume launches `claude --resume <uuid>` in a VS Code integrated
  terminal after validating the UUID and project path.

## Build

```bash
npm install
npm run compile
```

The bundle is written to `dist/extension.cjs`. The VS Code API is externalized;
Swoop core is bundled from the repository source.

## Manual Smoke Test

1. Open this repository in VS Code.
2. Open `extension/` as an extension-development folder, or configure an
   Extension Host launch that uses `extension/package.json`.
3. Run `npm install && npm run compile` inside `extension/`.
4. Start an Extension Host.
5. Run `Swoop: Diagnostics`.
6. Run `Swoop: Resume Here` and confirm matching sessions are ranked first.
7. Run `Swoop: Open Resume Card` and confirm it opens a `swoop:` Markdown
   document.
8. Open the Swoop Activity Bar view and use Refresh / Copy Session ID / Resume.

## Guardrails

- No telemetry.
- No network requests.
- No transcript writes.
- No shell interpolation with untrusted values.
- Mutation commands are intentionally deferred.

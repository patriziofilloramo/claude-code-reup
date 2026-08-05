# Security

## Reporting

Please report security issues privately to the maintainer before public
disclosure. Do not include secrets or private transcripts in a public issue.

## Scope

Reup is a local developer tool. The supported security boundary for the first
public release is:

- local CLI, TUI, and VS Code extension behavior;
- the localhost-only web UI;
- release artifacts and checksums;
- Reup-owned metadata under the Claude Code config directory.

## Web UI Threat Model

The web UI binds 127.0.0.1 only, which stops remote hosts from connecting but
not a browser the user already trusts. Two controls close that gap, and both
must stay in place:

- **Loopback-host middleware.** Every request, read or write, is rejected
  unless its `Host` header is `localhost` or `127.0.0.1`. This is what defeats
  DNS rebinding, where an attacker's domain resolves to 127.0.0.1 and the
  same-origin policy stops protecting responses. It is registered once in
  `buildApp`, never per route.
- **Origin check on mutations.** State-changing routes additionally require the
  request to come from the Reup page itself, via `guardedRoute`.

Beyond transport, treat everything read from a transcript as untrusted input:
session names, project paths, branches, and tool output all originate outside
Reup and reach the UI. Escape them at the point of rendering. The
Content-Security-Policy on the page authorises scripts by nonce and is defence
in depth, not a substitute for escaping.

## Data Integrity

Reup owns metadata that the user cannot reconstruct — aliases, tags, and
archive state in `reup.json`, groups and stacks in `org.json`. A file that
cannot be read is never treated as an empty one: updates refuse and name the
file to repair, rather than replacing content they could not parse. Read paths
may degrade to "no metadata" so a single damaged file cannot hide a project.

## Release Expectations

The beta-candidate pipeline produces SHA-256 checksums, root and extension
SBOM snapshots, explicit build metadata, and exact npm/VSIX policy checks. It
does not yet produce signatures, notarization, or CI-backed provenance
attestations. A public beta may promote only the exact reviewed candidate
artifact; it must not be rebuilt after validation. See
`Documents/INSTALLATION.md` for the release and verification policy.

## Data Handling

Reup does not intentionally collect telemetry or operate a remote service.
Avoid attaching transcripts, logs, handoff packets, or screenshots to reports
unless you have reviewed them for secrets first.

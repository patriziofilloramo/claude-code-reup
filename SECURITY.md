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

## Release Expectations

Public release artifacts should include SHA-256 checksums, signatures, SBOM,
and provenance attestations where the release pipeline supports them. Verify
artifacts before installing.

## Data Handling

Reup does not intentionally collect telemetry or operate a remote service.
Avoid attaching transcripts, logs, handoff packets, or screenshots to reports
unless you have reviewed them for secrets first.

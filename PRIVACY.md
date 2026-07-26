# Privacy

Reup is local-first.

- No Reup account is required.
- Reup does not include telemetry.
- Reup does not upload transcripts to a Reup service.
- The web UI binds to `127.0.0.1` and rejects any request — reads included —
  that does not address it as `localhost` or `127.0.0.1`, so a web page cannot
  reach your local data by pointing its own domain at the loopback address.
- Usage integrations store only aggregate local snapshots where supported.
- Files Reup writes under `~/.claude/reup/` are created owner-only.

Reup reads Claude Code local files, including transcript metadata and transcript
content when you use preview, handoff, touched-file lookup, or deep search. That
data remains on your machine unless you copy, export, publish, or otherwise
share it yourself.

You remain responsible for secrets in local transcripts, handoff output,
screenshots, logs, issue reports, and support requests.

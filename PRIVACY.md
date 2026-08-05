# Privacy

Reup is local-first.

- No Reup account is required.
- Reup does not include telemetry.
- Reup does not upload transcripts to a Reup service.
- For live-state discovery, Reup may run the installed
  `claude agents --json` command locally. It retains only the fields needed to
  address and classify sessions (ID, working directory, kind/process, state,
  wait reason, and timestamps); descriptive names and summaries are discarded.
  The command runtime, output size, and accepted record count are bounded.
- The web UI binds to `127.0.0.1` and rejects any request — reads included —
  that does not address it as `localhost` or `127.0.0.1`, so a web page cannot
  reach your local data by pointing its own domain at the loopback address.
- Account-usage requests are disabled until you run `reup usage setup`. After
  that explicit opt-in, Reup reads Claude Code's OAuth token in memory to query
  Anthropic's account-usage endpoint and stores only aggregate percentages,
  reset times, and freshness. `reup usage remove` removes that integration and
  its cache.
- The first TUI, web, or configuration launch may add or repair Reup-owned
  attention-hook entries in Claude Code settings. The write is announced and
  reversible with `reup attention remove`; removing it records an opt-out.
- Reup-owned files under `~/.claude/reup/` are created owner-only.

Reup reads Claude Code local files, including transcript metadata and transcript
content when you use preview, handoff, touched-file lookup, or deep search. That
data remains on your machine unless you copy, export, publish, or otherwise
share it yourself.

You remain responsible for secrets in local transcripts, handoff output,
screenshots, logs, issue reports, and support requests.

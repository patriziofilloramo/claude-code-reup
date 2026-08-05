## Outcome

<!-- What user problem does this solve? Describe the observable result. -->

## Scope

<!-- Summarize the implementation and the important work intentionally left out. -->

## Evidence

- [ ] `npm run check:version`
- [ ] `npm run format:check`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run build:extension`
- [ ] `npm test`
- [ ] `npm run package:extension`
- [ ] `git diff --check`
- [ ] Manual verification completed, or not applicable with an explanation below

<!-- Include focused test names, manual scenarios, and relevant before/after facts. -->

## Risk and rollback

<!-- Cover compatibility, privacy, persisted data, external processes, and rollback. -->

- [ ] Claude-owned transcripts remain read-only
- [ ] New external or persisted data is validated at runtime
- [ ] Destructive behavior is explicit, reversible where possible, and tested
- [ ] No real transcripts, credentials, private paths, or customer data are included

## Durable decisions

<!-- Link the architecture, roadmap, or project-memory update, or explain why none is needed. -->

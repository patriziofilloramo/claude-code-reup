import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CLIENT_PATH = join(process.cwd(), 'src', 'web', 'client.js')

describe('web client — org inbox and tag UI invariants', () => {
  let source: string

  beforeAll(async () => {
    source = await readFile(CLIENT_PATH, 'utf8')
  })

  function sourceBetween(start: string, end: string): string {
    const from = source.indexOf(start)
    const to = source.indexOf(end)
    return from === -1 || to === -1 ? '' : source.slice(from, to)
  }

  // ─── 1. Inbox bucket priority ordering and archived exclusion ───────────────

  it('REVIEW_BUCKETS are defined in the correct priority order', () => {
    const bucketsBlock = sourceBetween('const REVIEW_BUCKETS = [', 'let projects = []')

    // Priority order: active → attention → branch-drift → path-missing →
    //                 high-context → expiring → recent
    const idxActive = bucketsBlock.indexOf("id: 'active'")
    const idxAttention = bucketsBlock.indexOf("id: 'attention'")
    const idxDrift = bucketsBlock.indexOf("id: 'branch-drift'")
    const idxMissing = bucketsBlock.indexOf("id: 'path-missing'")
    const idxCtx = bucketsBlock.indexOf("id: 'high-context'")
    const idxExpiring = bucketsBlock.indexOf("id: 'expiring'")
    const idxRecent = bucketsBlock.indexOf("id: 'recent'")

    expect(idxActive).toBeGreaterThan(-1)
    expect(idxActive).toBeLessThan(idxAttention)
    expect(idxAttention).toBeLessThan(idxDrift)
    expect(idxDrift).toBeLessThan(idxMissing)
    expect(idxMissing).toBeLessThan(idxCtx)
    expect(idxCtx).toBeLessThan(idxExpiring)
    expect(idxExpiring).toBeLessThan(idxRecent)
  })

  it('attention bucket tests only interrupted/lastToolFailed — not expiring or path-missing', () => {
    const attentionBucket = sourceBetween("id: 'attention'", "id: 'branch-drift'")

    expect(attentionBucket).toContain('session.signals.interrupted')
    expect(attentionBucket).toContain('session.signals.lastToolFailed')
    // expiring and path-missing must NOT be in the attention test — they have their own buckets
    expect(attentionBucket).not.toContain('expiresInDays')
    expect(attentionBucket).not.toContain('pathExists')
  })

  it('countReviewBucketSessionsForProject excludes archived sessions', () => {
    const countFn = sourceBetween(
      'function countReviewBucketSessionsForProject(',
      'function applyReviewSearchToken('
    )

    expect(countFn).toContain('session.signals.archived')
    // Must negate the archived flag to exclude those sessions
    expect(countFn).toMatch(/!session\.signals\.archived/)
  })

  // ─── 2. Smart View counts from fixture-like structure ───────────────────────

  it('renderReviewSignals iterates all REVIEW_BUCKETS and calls countReviewBucketSessionsForProject', () => {
    const renderFn = sourceBetween(
      'function renderReviewSignals()',
      'function countReviewBucketSessions('
    )

    expect(renderFn).toContain('REVIEW_BUCKETS.length')
    expect(renderFn).toContain('countReviewBucketSessionsForProject(selectedProject, bucket)')
    // Zero-count buckets are skipped — only non-empty ones render
    expect(renderFn).toContain('if (count === 0) continue')
  })

  // ─── 3. Focus filter applied to project/session list ────────────────────────

  it('deriveVisibleProjects filters projects through focusFilter via getSessionsMatchingFocus', () => {
    const deriveFn = sourceBetween('function deriveVisibleProjects()', 'function renderProjects()')

    expect(deriveFn).toContain('if (focusFilter)')
    expect(deriveFn).toContain('getSessionsMatchingFocus(project)')
    // Projects with no matching sessions are hidden (undefined = excluded)
    expect(deriveFn).toContain('if (focusSessions === undefined) return false')
    // Projects with null sessions show all sessions (null = no session constraint)
    expect(deriveFn).toContain('if (focusSessions === null) return true')
    // Projects whose sessions are all non-matching are hidden
    expect(deriveFn).toContain('focusSessions.length > 0')
  })

  it('getSessionsMatchingFocus handles all focusFilter kinds', () => {
    const matchFn = sourceBetween(
      'if (!focusFilter) return null',
      'if (!focusFilter || !orgData) return'
    )

    expect(matchFn).toContain("focusFilter.kind === 'review'")
    expect(matchFn).toContain("focusFilter.kind === 'stack'")
    expect(matchFn).toContain("focusFilter.kind === 'group'")
    expect(matchFn).toContain("focusFilter.kind === 'tag'")
  })

  // ─── 4. Chip overflow cap ────────────────────────────────────────────────────

  it('buildTagChipsHtml caps visible chips at TAG_CHIPS_MAX and shows +N overflow', () => {
    expect(source).toContain('const TAG_CHIPS_MAX = 2')

    const chipFn = sourceBetween('function buildTagChipsHtml(', 'function buildSessionRowHtml(')

    expect(chipFn).toContain('tags.slice(0, TAG_CHIPS_MAX)')
    expect(chipFn).toContain('tags.length - shown.length')
    // Overflow badge is rendered only when overflow > 0
    expect(chipFn).toContain('if (overflow > 0)')
    expect(chipFn).toContain('s-tag-overflow')
    expect(chipFn).toContain('tagChipOverflow')
  })

  // ─── 5. Tag picker palette order preserved (recency-first = palette order) ──

  it('tagPickerSuggestions returns palette in its stored order without re-sorting', () => {
    const suggestionsFn = sourceBetween(
      'function tagPickerSuggestions(',
      'function renderTagPickerSuggestions('
    )

    // Suggestions come from the palette directly — palette is already in recency order
    expect(suggestionsFn).toContain('orgData.tagPalette')
    // Must NOT sort alphabetically or by any comparator — recency order must be preserved
    expect(suggestionsFn).not.toContain('.sort(')
    // Already-selected tags are excluded from suggestions
    expect(suggestionsFn).toContain('tagPickerTags.indexOf(tag) === -1')
    // Query filtering narrows but does not reorder
    expect(suggestionsFn).toContain('tag.toLowerCase().includes(normalizedQuery)')
  })
})

import type { StackItem } from './org-model.js'

const TAG_PATTERN = /^[a-z0-9-]+$/
const TAG_MAX_LENGTH = 32
const TAG_MAX_PER_SESSION = 8
const NAME_MAX_LENGTH = 64

export class OrgValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrgValidationError'
  }
}

/** Trims and lowercases a raw tag string before validation. */
export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Throws OrgValidationError if the already-normalized tag name is invalid. */
export function validateNormalizedTag(tag: string): void {
  if (!tag) throw new OrgValidationError('tag must not be empty')
  if (tag.length > TAG_MAX_LENGTH) {
    throw new OrgValidationError(`tag exceeds ${TAG_MAX_LENGTH} characters: "${tag}"`)
  }
  if (!TAG_PATTERN.test(tag)) {
    throw new OrgValidationError(
      `tag contains invalid characters: "${tag}" (only a-z, 0-9, and - are allowed)`
    )
  }
}

/**
 * Normalizes, validates, and deduplicates a tag list.
 * Returns the cleaned list ready to store.
 */
export function validateAndNormalizeTags(rawTags: unknown[]): string[] {
  if (!Array.isArray(rawTags)) throw new OrgValidationError('tags must be an array')
  if (rawTags.length > TAG_MAX_PER_SESSION) {
    throw new OrgValidationError(`a session may have at most ${TAG_MAX_PER_SESSION} tags`)
  }
  const normalized = rawTags.map((t) => {
    if (typeof t !== 'string') throw new OrgValidationError('each tag must be a string')
    return normalizeTagName(t)
  })
  normalized.forEach(validateNormalizedTag)
  // Deduplicate preserving first occurrence order.
  return [...new Set(normalized)]
}

/**
 * Validates a group or stack name.
 * Returns the trimmed name, ready to store.
 */
export function validateAndTrimName(raw: unknown, kind: 'group' | 'stack'): string {
  if (typeof raw !== 'string') throw new OrgValidationError(`${kind} name must be a string`)
  const trimmed = raw.trim()
  if (!trimmed) throw new OrgValidationError(`${kind} name must not be empty`)
  if (trimmed.length > NAME_MAX_LENGTH) {
    throw new OrgValidationError(`${kind} name exceeds ${NAME_MAX_LENGTH} characters`)
  }
  return trimmed
}

/** Validates a StackItem object from request body. */
export function validateStackItem(raw: unknown): StackItem {
  if (!raw || typeof raw !== 'object') throw new OrgValidationError('stack item must be an object')
  const obj = raw as Record<string, unknown>

  if (obj.kind !== 'project' && obj.kind !== 'session') {
    throw new OrgValidationError('stack item kind must be "project" or "session"')
  }
  if (typeof obj.projectId !== 'string' || !obj.projectId) {
    throw new OrgValidationError('stack item projectId must be a non-empty string')
  }
  if (obj.kind === 'session') {
    if (typeof obj.sessionId !== 'string' || !obj.sessionId) {
      throw new OrgValidationError(
        'stack item sessionId must be a non-empty string for kind "session"'
      )
    }
    return { kind: 'session', projectId: obj.projectId, sessionId: obj.sessionId }
  }
  return { kind: 'project', projectId: obj.projectId }
}

/** Returns the stable key used for stack item deduplication. */
export function stackItemKey(item: StackItem): string {
  return item.kind === 'session'
    ? `${item.projectId}:${item.sessionId}`
    : `project:${item.projectId}`
}

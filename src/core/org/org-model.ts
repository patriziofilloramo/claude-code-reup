/** Org schema version stored in org.json. Bump when the shape changes incompatibly. */
export const ORG_SCHEMA_VERSION = 1 as const

/** Top-level shape of ~/.claude/reup/org.json. */
export interface OrgData {
  schemaVersion: typeof ORG_SCHEMA_VERSION
  /** Global ordered tag palette — best-effort recency cache, not source of truth. */
  tagPalette: string[]
  groups: ProjectGroup[]
  stacks: WorkStack[]
  /** Maps projectId → groupId for the one group a project belongs to. */
  projectGroupAssignments: Record<string, string>
}

/** A named bucket that contains projects. */
export interface ProjectGroup {
  id: string
  name: string
  color?: string
}

/** A named intent that contains projects and/or individual sessions. */
export interface WorkStack {
  id: string
  name: string
  items: StackItem[]
  color?: string
}

/** A single member of a WorkStack — either a whole project or one session. */
export interface StackItem {
  kind: 'project' | 'session'
  projectId: string
  /** Only present when kind === 'session'. */
  sessionId?: string
}

/** Error thrown when a write is attempted against an org.json with an unknown schemaVersion. */
export class OrgSchemaVersionError extends Error {
  constructor(readonly detectedVersion: unknown) {
    super(
      `org.json: unsupported schemaVersion ${String(detectedVersion)} — refusing write to avoid data loss`
    )
    this.name = 'OrgSchemaVersionError'
  }
}

/**
 * Error thrown when org.json exists but cannot be parsed, and a write was
 * requested.
 *
 * Same contract as {@link OrgSchemaVersionError}: the file is left untouched
 * and the caller is told what to repair, rather than the write silently
 * replacing groups and stacks it could not read.
 */
export class OrgDataUnreadableError extends Error {
  constructor(
    readonly path: string,
    options?: { cause?: unknown }
  ) {
    super(
      `cannot read ${path}; refusing to overwrite it. Repair or delete the file, then retry.`,
      options
    )
    this.name = 'OrgDataUnreadableError'
  }
}

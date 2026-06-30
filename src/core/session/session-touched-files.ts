// ---------------------------------------------------------------------------
// Shared rules for "which tool invocations write a file, and to which path".
//
// This is the single source of truth for the write-like-tool invariant. Both
// automatic-context extraction and the reverse file→session lookup depend on it
// so the two never drift on which tools count as touching a file.
// ---------------------------------------------------------------------------

/** True when a (lower-cased) tool name writes or modifies a file on disk. */
export function isWriteLikeTool(normalizedToolName: string): boolean {
  return (
    normalizedToolName.includes('edit') ||
    normalizedToolName === 'write' ||
    normalizedToolName === 'notebookedit'
  )
}

/**
 * Returns the filesystem path(s) a write-like tool invocation targets, in a
 * stable order. Non-string inputs are ignored — transcript data is external and
 * must be validated, not asserted. A notebook edit can carry both a primary
 * path and a notebook path; both are returned when present.
 */
export function extractWriteToolPaths(input: Record<string, unknown> | null | undefined): string[] {
  if (!input) return []
  const paths: string[] = []
  const primaryPath = nonEmptyString(input['file_path']) ?? nonEmptyString(input['path'])
  const notebookPath = nonEmptyString(input['notebook_path'])
  if (primaryPath) paths.push(primaryPath)
  if (notebookPath) paths.push(notebookPath)
  return paths
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

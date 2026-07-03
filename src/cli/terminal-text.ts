export const DEFAULT_TERMINAL_WIDTH = 100

/** Plain-text session state markers shared by the CLI tables. */
export const SESSION_ACTIVE_MARKER = '●'
export const SESSION_IDLE_MARKER = '○'

const ESCAPE_CHARACTER = String.fromCharCode(27)
const ANSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-9;]*m`, 'g')
const ANSI_SPLIT_PATTERN = new RegExp(`(${ESCAPE_CHARACTER}\\[[0-9;]*m)`)
const ANSI_ONLY_PATTERN = new RegExp(`^${ESCAPE_CHARACTER}\\[[0-9;]*m$`)
const ANSI_RESET = `${ESCAPE_CHARACTER}[0m`
const TRUNCATION_SUFFIX = '...'

export function terminalWidthOrDefault(
  width: number | undefined,
  fallback = DEFAULT_TERMINAL_WIDTH
): number {
  return typeof width === 'number' && Number.isSafeInteger(width) && width > 0 ? width : fallback
}

export function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '')
}

export function visibleLength(value: string): number {
  return Array.from(stripAnsi(value)).length
}

/**
 * Keeps the first `count` visible code points. Style sequences are never split
 * or counted against the budget; when styled text is cut, a reset is appended
 * so the dropped tail cannot bleed colour into the rest of the line.
 */
function takeVisibleStart(value: string, count: number): string {
  let remaining = count
  let result = ''
  let containsStyle = false
  let truncated = false
  for (const part of value.split(ANSI_SPLIT_PATTERN)) {
    if (part === '') continue
    if (ANSI_ONLY_PATTERN.test(part)) {
      result += part
      containsStyle = true
      continue
    }
    const characters = Array.from(part)
    if (characters.length <= remaining) {
      result += part
      remaining -= characters.length
      continue
    }
    result += characters.slice(0, remaining).join('')
    truncated = true
    break
  }
  if (truncated && containsStyle && !result.endsWith(ANSI_RESET)) result += ANSI_RESET
  return result
}

/**
 * Keeps the last `count` visible code points. Styles opened before the cut are
 * dropped with the text they styled; styles inside the kept tail survive.
 */
function takeVisibleEnd(value: string, count: number): string {
  const parts = value.split(ANSI_SPLIT_PATTERN).filter((part) => part !== '')
  let remaining = count
  let result = ''
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index] as string
    if (ANSI_ONLY_PATTERN.test(part)) {
      result = part + result
      continue
    }
    const characters = Array.from(part)
    if (characters.length <= remaining) {
      result = part + result
      remaining -= characters.length
      continue
    }
    result = characters.slice(characters.length - remaining).join('') + result
    break
  }
  return result
}

export function truncateVisible(value: string, maximumLength: number): string {
  const compact = compactWhitespace(value)
  if (maximumLength <= 0) return ''
  if (visibleLength(compact) <= maximumLength) return compact
  if (maximumLength <= TRUNCATION_SUFFIX.length) {
    return TRUNCATION_SUFFIX.slice(0, maximumLength)
  }
  return takeVisibleStart(compact, maximumLength - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}

export function clipVisible(value: string, maximumLength: number): string {
  const compact = compactWhitespace(value)
  if (maximumLength <= 0) return ''
  if (visibleLength(compact) <= maximumLength) return compact
  return takeVisibleStart(compact, maximumLength)
}

/**
 * Same bound as `clipVisible` but does not collapse or trim whitespace. Used
 * internally for structural layout fragments (a fixed prefix, an already
 * assembled row) where a deliberate separator space must survive — unlike
 * `clipVisible`, which is meant for free-text field values.
 */
function clipPreservingWhitespace(value: string, maximumLength: number): string {
  if (maximumLength <= 0) return ''
  if (visibleLength(value) <= maximumLength) return value
  return takeVisibleStart(value, maximumLength)
}

export function truncateVisibleStart(value: string, maximumLength: number): string {
  const compact = compactWhitespace(value)
  if (maximumLength <= 0) return ''
  if (visibleLength(compact) <= maximumLength) return compact
  if (maximumLength <= TRUNCATION_SUFFIX.length) {
    return TRUNCATION_SUFFIX.slice(0, maximumLength)
  }
  return TRUNCATION_SUFFIX + takeVisibleEnd(compact, maximumLength - TRUNCATION_SUFFIX.length)
}

export function padVisibleEnd(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - visibleLength(value)))
}

export function compactRelativeTimeLabel(value: string): string {
  return value.replace(/\s+ago$/, '')
}

export interface SingleLineRowOptions {
  coreParts?: string[]
  metadataParts?: string[]
  metadataSeparator?: string
  prefix: string
  primary: string
  primaryMaxWidth?: number
  primaryMinWidth?: number
  primaryMetadataSeparator?: string
  width: number
}

/**
 * Lays out one `prefix + primary + metadata` line inside `width`. Core parts
 * always stay; optional metadata parts are dropped from the end, one at a
 * time, before the primary column may shrink below `primaryMinWidth`.
 */
export function formatSingleLineRow({
  coreParts = [],
  metadataParts = [],
  metadataSeparator = ' | ',
  prefix,
  primary,
  primaryMaxWidth,
  primaryMetadataSeparator = '  ',
  primaryMinWidth = 12,
  width,
}: SingleLineRowOptions): string {
  const safeWidth = Math.max(1, width)
  const safePrefix = clipPreservingWhitespace(prefix, safeWidth)
  const core = coreParts.filter(Boolean)
  const optional = metadataParts.filter(Boolean)

  function formatWithMetadata(parts: string[]): string | null {
    const metadata = [...core, ...parts].join(metadataSeparator)
    const metadataText = metadata ? primaryMetadataSeparator + metadata : ''
    const primaryWidth = safeWidth - visibleLength(safePrefix) - visibleLength(metadataText)
    const resolvedPrimaryWidth = Math.max(
      0,
      primaryMaxWidth === undefined ? primaryWidth : Math.min(primaryWidth, primaryMaxWidth)
    )
    if (resolvedPrimaryWidth < primaryMinWidth && parts.length > 0) return null
    return clipPreservingWhitespace(
      `${safePrefix}${clipVisible(primary, resolvedPrimaryWidth)}${metadataText}`,
      safeWidth
    )
  }

  while (optional.length > 0) {
    const formatted = formatWithMetadata(optional)
    if (formatted !== null) return formatted
    optional.pop()
  }
  return formatWithMetadata([]) ?? safePrefix
}

export const DEFAULT_TERMINAL_WIDTH = 100

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const TRUNCATION_SUFFIX = '...'

export function terminalWidthOrDefault(width: number | undefined): number {
  return typeof width === 'number' && Number.isSafeInteger(width) && width > 0
    ? width
    : DEFAULT_TERMINAL_WIDTH
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

export function truncateVisible(value: string, maximumLength: number): string {
  const compact = compactWhitespace(value)
  if (maximumLength <= 0) return ''
  if (visibleLength(compact) <= maximumLength) return compact
  if (maximumLength <= TRUNCATION_SUFFIX.length) {
    return TRUNCATION_SUFFIX.slice(0, maximumLength)
  }
  return (
    Array.from(compact)
      .slice(0, maximumLength - TRUNCATION_SUFFIX.length)
      .join('') + TRUNCATION_SUFFIX
  )
}

export function clipVisible(value: string, maximumLength: number): string {
  const compact = compactWhitespace(value)
  if (maximumLength <= 0) return ''
  if (visibleLength(compact) <= maximumLength) return compact
  return Array.from(compact).slice(0, maximumLength).join('')
}

export function truncateVisibleStart(value: string, maximumLength: number): string {
  const compact = compactWhitespace(value)
  if (maximumLength <= 0) return ''
  if (visibleLength(compact) <= maximumLength) return compact
  if (maximumLength <= TRUNCATION_SUFFIX.length) {
    return TRUNCATION_SUFFIX.slice(0, maximumLength)
  }
  return (
    TRUNCATION_SUFFIX +
    Array.from(compact)
      .slice(-(maximumLength - TRUNCATION_SUFFIX.length))
      .join('')
  )
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
  const safePrefix = clipVisible(prefix, safeWidth)
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
    return clipVisible(
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

export function joinMetadataWithinWidth(parts: string[], width: number): string {
  return truncateVisible(parts.filter(Boolean).join(' | '), width)
}

import { terminalWidthOrDefault } from '../cli/terminal-text.js'

/**
 * One-line picker row layout. The meta tiers describe reveal order, not visual
 * order: `primaryMeta` appears first as the terminal widens, `tertiaryMeta`
 * last. Each picker decides which datum goes in which tier and where the tier
 * sits in the row; every visible tier renders a fixed-width column so rows
 * stay aligned regardless of per-row content.
 */
export interface PickerRowLayout {
  coreMetaWidth: number
  primaryMetaWidth: number
  primaryWidth: number
  secondaryMetaWidth: number
  showPrimaryMeta: boolean
  showSecondaryMeta: boolean
  showTertiaryMeta: boolean
  tertiaryMetaWidth: number
  width: number
}

const PICKER_DEFAULT_TERMINAL_WIDTH = 80

const PICKER_ROW_WIDTHS = {
  minLayout: 56,
  primaryMeta: 64,
  secondaryMeta: 82,
  tertiaryMeta: 104,
} as const

const PICKER_ROW_COLUMNS = {
  chromeReserve: 7,
  coreMeta: 8,
  primaryMeta: 7,
  secondaryMeta: 11,
  tertiaryMeta: 18,
} as const

export function pickerRowLayoutForWidth(width: number | undefined): PickerRowLayout {
  const terminalWidth = terminalWidthOrDefault(width, PICKER_DEFAULT_TERMINAL_WIDTH)
  const resolvedWidth = Math.max(terminalWidth, PICKER_ROW_WIDTHS.minLayout)
  const showPrimaryMeta = terminalWidth >= PICKER_ROW_WIDTHS.primaryMeta
  const showSecondaryMeta = terminalWidth >= PICKER_ROW_WIDTHS.secondaryMeta
  const showTertiaryMeta = terminalWidth >= PICKER_ROW_WIDTHS.tertiaryMeta
  const metadataWidth =
    (showPrimaryMeta ? PICKER_ROW_COLUMNS.primaryMeta : 0) +
    (showSecondaryMeta ? PICKER_ROW_COLUMNS.secondaryMeta : 0) +
    (showTertiaryMeta ? PICKER_ROW_COLUMNS.tertiaryMeta : 0)
  const metadataGaps =
    Number(showPrimaryMeta) + Number(showSecondaryMeta) + Number(showTertiaryMeta)
  const primaryMaxWidth =
    terminalWidth >= PICKER_ROW_WIDTHS.tertiaryMeta
      ? 72
      : terminalWidth >= PICKER_ROW_WIDTHS.secondaryMeta
        ? 64
        : terminalWidth >= PICKER_ROW_WIDTHS.primaryMeta
          ? 56
          : 48

  return {
    coreMetaWidth: PICKER_ROW_COLUMNS.coreMeta,
    primaryMetaWidth: PICKER_ROW_COLUMNS.primaryMeta,
    primaryWidth: Math.max(
      1,
      Math.min(
        primaryMaxWidth,
        resolvedWidth - PICKER_ROW_COLUMNS.chromeReserve - metadataWidth - metadataGaps
      )
    ),
    secondaryMetaWidth: PICKER_ROW_COLUMNS.secondaryMeta,
    showPrimaryMeta,
    showSecondaryMeta,
    showTertiaryMeta,
    tertiaryMetaWidth: PICKER_ROW_COLUMNS.tertiaryMeta,
    width: resolvedWidth,
  }
}

export function pickerSessionRowLayoutForWidth(width: number | undefined): PickerRowLayout {
  const layout = pickerRowLayoutForWidth(width)
  return {
    ...layout,
    primaryWidth: Math.max(1, layout.primaryWidth - layout.coreMetaWidth - 1),
  }
}

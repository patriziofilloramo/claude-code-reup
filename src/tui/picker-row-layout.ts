export interface PickerRowLayout {
  coreMetaWidth: number
  primaryMetaWidth: number
  primaryWidth: number
  quaternaryMetaWidth: number
  secondaryMetaWidth: number
  showPrimaryMeta: boolean
  showSecondaryMeta: boolean
  showTertiaryMeta: boolean
  showQuaternaryMeta: boolean
  tertiaryMetaWidth: number
  width: number
}

const PICKER_ROW_WIDTHS = {
  minLayout: 56,
  primaryMeta: 64,
  secondaryMeta: 82,
  tertiaryMeta: 104,
  quaternaryMeta: 120,
} as const

const PICKER_ROW_COLUMNS = {
  chromeReserve: 7,
  coreMeta: 8,
  primaryMeta: 7,
  secondaryMeta: 11,
  tertiaryMeta: 18,
  quaternaryMeta: 8,
} as const

export function pickerRowLayoutForWidth(width: number | undefined): PickerRowLayout {
  const terminalWidth =
    typeof width === 'number' && Number.isSafeInteger(width) && width > 0 ? width : 80
  const resolvedWidth = Math.max(terminalWidth, PICKER_ROW_WIDTHS.minLayout)
  const showPrimaryMeta = terminalWidth >= PICKER_ROW_WIDTHS.primaryMeta
  const showSecondaryMeta = terminalWidth >= PICKER_ROW_WIDTHS.secondaryMeta
  const showTertiaryMeta = terminalWidth >= PICKER_ROW_WIDTHS.tertiaryMeta
  const showQuaternaryMeta = terminalWidth >= PICKER_ROW_WIDTHS.quaternaryMeta
  const metadataWidth =
    (showPrimaryMeta ? PICKER_ROW_COLUMNS.primaryMeta : 0) +
    (showSecondaryMeta ? PICKER_ROW_COLUMNS.secondaryMeta : 0) +
    (showTertiaryMeta ? PICKER_ROW_COLUMNS.tertiaryMeta : 0) +
    (showQuaternaryMeta ? PICKER_ROW_COLUMNS.quaternaryMeta : 0)
  const metadataGaps =
    Number(showPrimaryMeta) +
    Number(showSecondaryMeta) +
    Number(showTertiaryMeta) +
    Number(showQuaternaryMeta)
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
    quaternaryMetaWidth: PICKER_ROW_COLUMNS.quaternaryMeta,
    secondaryMetaWidth: PICKER_ROW_COLUMNS.secondaryMeta,
    showPrimaryMeta,
    showSecondaryMeta,
    showTertiaryMeta,
    showQuaternaryMeta,
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

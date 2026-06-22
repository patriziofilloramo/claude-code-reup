/** Canonical Swoop brand definition shared by every product surface and generated asset. */

/** Primary Swoop blue used by the mark background. */
export const BRAND_COLOR = '#2EA8D3'
/** Deeper blue used by the mark gradient. */
export const BRAND_COLOR_DEEP = '#187FA8'
/** Claude Code coral used only for subtitles and secondary accents. */
export const BRAND_COLOR_MID = '#E06848'

/**
 * SVG path data for the Swoop S-curve (256×256 viewBox).
 * Used inline across all surfaces — web, extension webview, PNG export.
 */
export const SWOOP_PATH =
  'M52 80C84 42 153 39 207 64L180 91C137 72 104 76 82 98C104 111 135 112 163 117C198 123 216 143 209 169C198 209 127 226 60 190L86 163C132 186 171 179 181 159C162 146 135 145 105 139C65 131 41 111 52 80Z'

export interface SwoopMarkOptions {
  ariaLabel?: string
  className?: string
  monochrome?: boolean
  size?: number
}

/** Returns the canonical mark. Generated assets and inline UIs use this geometry. */
export function renderSwoopMarkSvg(options: SwoopMarkOptions = {}): string {
  const size = options.size ?? 256
  const classAttribute = options.className ? ` class="${escapeAttribute(options.className)}"` : ''
  const accessibility = options.ariaLabel
    ? ` role="img" aria-label="${escapeAttribute(options.ariaLabel)}"`
    : ' aria-hidden="true"'
  if (options.monochrome) {
    return `<svg${classAttribute} width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg"${accessibility}><path fill="currentColor" d="${SWOOP_PATH}"/></svg>`
  }
  return `<svg${classAttribute} width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg"${accessibility}><defs><linearGradient id="swoopMarkGradient" x1="38" y1="34" x2="220" y2="222" gradientUnits="userSpaceOnUse"><stop stop-color="${BRAND_COLOR}"/><stop offset="1" stop-color="${BRAND_COLOR_DEEP}"/></linearGradient></defs><rect width="256" height="256" rx="52" fill="url(#swoopMarkGradient)"/><path fill="#FFFFFF" d="${SWOOP_PATH}"/></svg>`
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return replacements[character] ?? character
  })
}

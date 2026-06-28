/** Canonical Reup brand definition shared by every product surface and generated asset. */

/** Reup green used by the return/restore glyph. */
export const BRAND_COLOR = '#47D7A1'
/** Graphite used by the mark background. */
export const BRAND_COLOR_DEEP = '#101315'
/** Amber used for the terminal cursor and secondary accents. */
export const BRAND_COLOR_MID = '#F0B85A'

/**
 * SVG path data for the Reup return/restore glyph (256x256 viewBox).
 * Used inline across all surfaces: web, extension webview, PNG export.
 */
export const REUP_PATH =
  'M58 174H130C157 174 178 153 178 126V91H150L190 50L230 91H202V127C202 167 170 198 130 198H58Z'
export const REUP_ACCENT_PATH = 'M190 174H216V198H190Z'

export interface ReupMarkOptions {
  ariaLabel?: string
  className?: string
  monochrome?: boolean
  size?: number
}

/** Returns the canonical mark. Generated assets and inline UIs use this geometry. */
export function renderReupMarkSvg(options: ReupMarkOptions = {}): string {
  const size = options.size ?? 256
  const classAttribute = options.className ? ` class="${escapeAttribute(options.className)}"` : ''
  const accessibility = options.ariaLabel
    ? ` role="img" aria-label="${escapeAttribute(options.ariaLabel)}"`
    : ' aria-hidden="true"'
  if (options.monochrome) {
    return `<svg${classAttribute} width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg"${accessibility}><path fill="currentColor" d="${REUP_PATH}"/><path fill="currentColor" d="${REUP_ACCENT_PATH}"/></svg>`
  }
  return `<svg${classAttribute} width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg"${accessibility}><rect width="256" height="256" rx="52" fill="${BRAND_COLOR_DEEP}"/><path fill="${BRAND_COLOR}" d="${REUP_PATH}"/><path fill="${BRAND_COLOR_MID}" d="${REUP_ACCENT_PATH}"/></svg>`
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

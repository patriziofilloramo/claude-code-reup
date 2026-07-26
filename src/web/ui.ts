import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderReupMarkSvg } from '../brand.js'
import { THEMES } from '../config/themes/index.js'

const assetDirectory = dirname(fileURLToPath(import.meta.url))
const clientScript = readFileSync(join(assetDirectory, 'client.js'), 'utf8')
const styles = readFileSync(join(assetDirectory, 'styles.css'), 'utf8')
const template = readFileSync(join(assetDirectory, 'ui.html'), 'utf8')

/** Placeholder replaced with a fresh CSP nonce on every page render. */
const NONCE_PLACEHOLDER = '__REUP_NONCE__'
/** Placeholder replaced with the complete policy tied to the render nonce. */
const CSP_PLACEHOLDER = '__REUP_CSP__'

export interface UiDocument {
  contentSecurityPolicy: string
  html: string
}

const faviconSvg = renderReupMarkSvg({ size: 64 })
const faviconLink = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(faviconSvg).toString('base64')}" />`

const baseHtml = template
  .replace('<!-- REUP:BRAND_MARK -->', renderReupMarkSvg({ className: 'logo-mark', size: 18 }))
  .replace('<!-- REUP:FAVICON -->', faviconLink)
  .replace('<!-- REUP:STYLES -->', `<style>\n${styles}</style>`)
  .replace(
    '<!-- REUP:SCRIPT -->',
    `<script nonce="${NONCE_PLACEHOLDER}">\n${clientScript}</script>`
  )

/**
 * Assembles the complete browser application HTML with the given theme applied.
 *
 * Each render mints its own nonce so the value in the CSP header can never be
 * predicted from an earlier response.
 */
export function buildHtml(themeName: string): string {
  return buildUiDocument(themeName).html
}

/** Builds the HTML and its matching HTTP Content-Security-Policy header. */
export function buildUiDocument(themeName: string): UiDocument {
  const nonce = randomBytes(18).toString('base64')
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce)
  // A replacer function avoids `$` pattern semantics in string replacements.
  const html = baseHtml
    .replaceAll(NONCE_PLACEHOLDER, () => nonce)
    .replace(CSP_PLACEHOLDER, contentSecurityPolicy)
    .replace('data-theme="dark"', `data-theme="${resolveThemeAttribute(themeName)}"`)

  return { contentSecurityPolicy, html }
}

/** Keeps the document policy and the server response header in lockstep. */
function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/**
 * Keeps an unrecognised stored preference out of the document. The theme name
 * lands in an HTML attribute, and the preference file is editable by hand.
 */
function resolveThemeAttribute(themeName: string): string {
  return Object.hasOwn(THEMES, themeName) ? themeName : 'dark'
}

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderReupMarkSvg } from '../brand.js'

const assetDirectory = dirname(fileURLToPath(import.meta.url))
const clientScript = readFileSync(join(assetDirectory, 'client.js'), 'utf8')
const styles = readFileSync(join(assetDirectory, 'styles.css'), 'utf8')
const template = readFileSync(join(assetDirectory, 'ui.html'), 'utf8')

const faviconSvg = renderReupMarkSvg({ size: 64 })
const faviconLink = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(faviconSvg).toString('base64')}" />`

const baseHtml = template
  .replace('<!-- REUP:BRAND_MARK -->', renderReupMarkSvg({ className: 'logo-mark', size: 18 }))
  .replace('<!-- REUP:FAVICON -->', faviconLink)
  .replace('<!-- REUP:STYLES -->', `<style>\n${styles}</style>`)
  .replace('<!-- REUP:SCRIPT -->', `<script>\n${clientScript}</script>`)

/** Assembles the complete browser application HTML with the given theme applied. */
export function buildHtml(themeName: string): string {
  return baseHtml.replace('data-theme="dark"', `data-theme="${themeName}"`)
}

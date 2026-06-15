import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetDirectory = dirname(fileURLToPath(import.meta.url))
const clientScript = readFileSync(join(assetDirectory, 'client.js'), 'utf8')
const styles = readFileSync(join(assetDirectory, 'styles.css'), 'utf8')
const template = readFileSync(join(assetDirectory, 'ui.html'), 'utf8')

const baseHtml = template
  .replace('<!-- CCM:STYLES -->', `<style>\n${styles}</style>`)
  .replace('<!-- CCM:SCRIPT -->', `<script>\n${clientScript}</script>`)

/** Assembles the complete browser application HTML with the given theme applied. */
export function buildHtml(themeName: string): string {
  return baseHtml.replace('data-theme="dark"', `data-theme="${themeName}"`)
}

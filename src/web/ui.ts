import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assetDirectory = dirname(fileURLToPath(import.meta.url))
const clientScript = readFileSync(join(assetDirectory, 'client.js'), 'utf8')
const styles = readFileSync(join(assetDirectory, 'styles.css'), 'utf8')
const template = readFileSync(join(assetDirectory, 'ui.html'), 'utf8')

/** Complete browser application assembled from the maintained source assets. */
export const UI_HTML = template
  .replace('<!-- CCM:STYLES -->', `<style>\n${styles}</style>`)
  .replace('<!-- CCM:SCRIPT -->', `<script>\n${clientScript}</script>`)

import { copyFile, mkdir } from 'node:fs/promises'

const WEB_ASSETS = ['client.js', 'styles.css', 'ui.html']

await mkdir('dist/web', { recursive: true })
await Promise.all(
  WEB_ASSETS.map((assetName) => copyFile(`src/web/${assetName}`, `dist/web/${assetName}`))
)

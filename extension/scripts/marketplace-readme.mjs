import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { extensionRoot } from './brand-source.mjs'

const IMAGE_ASSETS = [
  {
    markdownPath: 'media/marketplace/dashboard-workflow.gif',
    mediaType: 'image/gif',
  },
  {
    markdownPath: 'media/marketplace/workspace-cockpit.png',
    mediaType: 'image/png',
  },
]

/** Builds the VSIX Details page with offline-safe embedded images. */
export async function buildPackagedReadme() {
  let readme = await readFile(join(extensionRoot, 'README.md'), 'utf8')

  for (const asset of IMAGE_ASSETS) {
    const bytes = await readFile(join(extensionRoot, asset.markdownPath))
    const dataUrl = `data:${asset.mediaType};base64,${bytes.toString('base64')}`
    const occurrences = readme.split(`](${asset.markdownPath})`).length - 1
    if (occurrences !== 1) {
      throw new Error(
        `Expected one README image reference to ${asset.markdownPath}; found ${occurrences}.`
      )
    }
    readme = readme.replace(`](${asset.markdownPath})`, `](${dataUrl})`)
  }

  return readme
}

import { Buffer } from 'node:buffer'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = join(extensionRoot, '..')
const brandSource = await readFile(join(repositoryRoot, 'src', 'brand.ts'), 'utf8')

const brandColor = readExport('BRAND_COLOR')
const brandColorDeep = readExport('BRAND_COLOR_DEEP')
const swoopPath = readExport('SWOOP_PATH')

const fullColorSvg = `<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="swoopMarkGradient" x1="38" y1="34" x2="220" y2="222" gradientUnits="userSpaceOnUse">
      <stop stop-color="${brandColor}"/>
      <stop offset="1" stop-color="${brandColorDeep}"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="52" fill="url(#swoopMarkGradient)"/>
  <path fill="#FFFFFF" d="${swoopPath}"/>
</svg>
`
const monochromeSvg = `<svg width="32" height="32" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="12" y="12" width="232" height="232" rx="44" stroke="#C5C5C5" stroke-width="16"/>
  <path fill="#C5C5C5" d="${swoopPath}"/>
</svg>
`

const mediaDirectory = join(extensionRoot, 'media')
await Promise.all([
  writeFile(join(mediaDirectory, 'swoop-brand.svg'), fullColorSvg, 'utf8'),
  writeFile(join(mediaDirectory, 'swoop.svg'), monochromeSvg, 'utf8'),
  sharp(Buffer.from(fullColorSvg))
    .png()
    .resize(256, 256)
    .toFile(join(mediaDirectory, 'swoop-brand.png')),
])

function readExport(name) {
  const match = brandSource.match(
    new RegExp(`export const ${name}\\s*=\\s*(?:\\n\\s*)?['"]([^'"]+)['"]`)
  )
  if (!match) throw new Error(`Unable to read ${name} from src/brand.ts`)
  return match[1]
}

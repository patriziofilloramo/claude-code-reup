import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import sharp from 'sharp'

import { extensionRoot, readBrandDefinition } from './brand-source.mjs'

const brand = await readBrandDefinition()

const fullColorSvg = `<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="52" fill="${brand.colorDeep}"/>
  <path fill="${brand.color}" d="${brand.path}"/>
  <path fill="${brand.colorMid}" d="${brand.accentPath}"/>
</svg>
`
const monochromeSvg = `<svg width="32" height="32" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="12" y="12" width="232" height="232" rx="44" stroke="#C5C5C5" stroke-width="16"/>
  <path fill="#C5C5C5" d="${brand.path}"/>
  <path fill="#C5C5C5" d="${brand.accentPath}"/>
</svg>
`

const mediaDirectory = join(extensionRoot, 'media')
await Promise.all([
  writeFile(join(mediaDirectory, 'reup-brand.svg'), fullColorSvg, 'utf8'),
  writeFile(join(mediaDirectory, 'reup.svg'), monochromeSvg, 'utf8'),
  sharp(Buffer.from(fullColorSvg))
    .png()
    .resize(256, 256)
    .toFile(join(mediaDirectory, 'reup-brand.png')),
])

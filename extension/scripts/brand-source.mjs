import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function readBrandDefinition() {
  const source = await readFile(join(extensionRoot, '..', 'src', 'brand.ts'), 'utf8')
  return {
    color: readExport(source, 'BRAND_COLOR'),
    colorDeep: readExport(source, 'BRAND_COLOR_DEEP'),
    colorMid: readExport(source, 'BRAND_COLOR_MID'),
    path: readExport(source, 'SWOOP_PATH'),
  }
}

function readExport(source, name) {
  const match = source.match(
    new RegExp(`export const ${name}\\s*=\\s*(?:\\n\\s*)?['"]([^'"]+)['"]`)
  )
  if (!match) throw new Error(`Unable to read ${name} from src/brand.ts`)
  return match[1]
}

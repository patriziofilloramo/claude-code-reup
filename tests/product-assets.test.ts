import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDemoFixture } from '../scripts/create-demo-fixture.mjs'

const SCREENSHOT_PATH = join('docs', 'assets', 'screenshot-web-dashboard.png')
const EXPECTED_SCREENSHOT_WIDTH = 1840
const EXPECTED_SCREENSHOT_HEIGHT = 1020
const FIXED_NOW = Date.parse('2026-08-01T12:00:00.000Z')
const temporaryParents: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('public product assets', () => {
  it('keeps the real dashboard capture and its documentation in sync', async () => {
    const screenshot = readFileSync(SCREENSHOT_PATH)
    const readme = await readFile('README.md', 'utf8')
    const landing = await readFile(join('docs', 'index.html'), 'utf8')

    expect(screenshot.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    expect(screenshot.readUInt32BE(16)).toBe(EXPECTED_SCREENSHOT_WIDTH)
    expect(screenshot.readUInt32BE(20)).toBe(EXPECTED_SCREENSHOT_HEIGHT)
    expect(readme).toContain('actual web app rendered from deterministic synthetic')
    expect(landing).toContain(`width="${EXPECTED_SCREENSHOT_WIDTH}"`)
    expect(landing).toContain(`height="${EXPECTED_SCREENSHOT_HEIGHT}"`)
    expect(landing).toContain(
      'Actual Reup web UI captured from deterministic synthetic session data.'
    )
  })

  it('generates only deterministic synthetic Claude data inside an explicit safe root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'reup-demo-test-'))
    temporaryParents.push(parent)
    const rootDirectory = join(parent, 'reup-product-demo')

    const first = await createDemoFixture({ livePid: 4242, now: FIXED_NOW, rootDirectory })
    const firstDigest = await fixtureDigest(rootDirectory)
    const fixtureFiles = await listFiles(rootDirectory)
    const transcriptFiles = fixtureFiles.filter((path) => path.endsWith('.jsonl'))

    expect(first.root).toBe(rootDirectory)
    expect(transcriptFiles).toHaveLength(7)
    expect(
      fixtureFiles.filter((path) => path.includes(`${join('claude', 'sessions')}`))
    ).toHaveLength(3)

    const fixtureText = (
      await Promise.all(fixtureFiles.map((path) => readFile(path, 'utf8')))
    ).join('\n')
    expect(fixtureText).not.toMatch(/patrizio|filloramo/i)
    expect(fixtureText).toContain('Approve production migration')
    expect(fixtureText).toContain('Permission needed to run the final migration check')

    await createDemoFixture({ livePid: 4242, now: FIXED_NOW, rootDirectory })
    expect(await fixtureDigest(rootDirectory)).toBe(firstDigest)
  })

  it('refuses a fixture deletion target outside the named demo root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'reup-demo-safety-'))
    temporaryParents.push(parent)

    await expect(
      createDemoFixture({
        livePid: 4242,
        now: FIXED_NOW,
        rootDirectory: join(parent, 'not-the-demo-root'),
      })
    ).rejects.toThrow('fixture root must end with reup-product-demo')
  })
})

async function fixtureDigest(rootDirectory: string): Promise<string> {
  const hash = createHash('sha256')
  for (const filePath of await listFiles(rootDirectory)) {
    hash.update(filePath.slice(rootDirectory.length))
    hash.update(await readFile(filePath))
  }
  return hash.digest('hex')
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(entryPath)))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

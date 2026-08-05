import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runTests } from '@vscode/test-electron'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const smokeRoot = await mkdtemp(join(tmpdir(), 'reup-vscode-smoke-'))
const smokeWorkspace = join(smokeRoot, 'workspace')
await mkdir(smokeWorkspace)

delete process.env.ELECTRON_RUN_AS_NODE

try {
  await runTests({
    extensionDevelopmentPath: extensionRoot,
    extensionTestsEnv: {
      CLAUDE_CONFIG_DIR: join(smokeRoot, 'claude'),
      REUP_DISABLE_CLAUDE_AGENTS: '1',
      REUP_NO_OPEN: '1',
    },
    extensionTestsPath: join(extensionRoot, 'dist', 'smoke-test.cjs'),
    launchArgs: [
      smokeWorkspace,
      '--disable-extensions',
      '--disable-gpu',
      `--extensions-dir=${join(smokeRoot, 'extensions')}`,
      `--user-data-dir=${join(smokeRoot, 'user-data')}`,
    ],
    version: '1.90.2',
  })
} finally {
  await rm(smokeRoot, { force: true, recursive: true })
}

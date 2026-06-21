import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runTests } from '@vscode/test-electron'

const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

delete process.env.ELECTRON_RUN_AS_NODE

await runTests({
  extensionDevelopmentPath: extensionRoot,
  extensionTestsPath: join(extensionRoot, 'dist', 'smoke-test.cjs'),
  launchArgs: [join(extensionRoot, '..'), '--disable-extensions'],
  version: '1.90.2',
})

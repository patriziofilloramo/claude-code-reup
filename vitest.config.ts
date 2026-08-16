import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // `vscode` exists only inside the extension host, so extension modules
      // could previously only be asserted against as source text. The stub lets
      // tests observe what the extension actually asks the editor to do.
      vscode: fileURLToPath(new URL('./tests/extension/vscode-stub.ts', import.meta.url)),
    },
  },
  test: {
    env: {
      // Unit tests must never inspect or start processes in the developer's
      // real Claude installation. Boundary tests inject a deterministic runner.
      REUP_DISABLE_CLAUDE_AGENTS: '1',
    },
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})

import { defineConfig } from 'vitest/config'

export default defineConfig({
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

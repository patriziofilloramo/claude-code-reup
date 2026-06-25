/**
 * Installs a pre-commit hook that runs lint-staged on staged files.
 * Run once after cloning: npm run hooks:install
 */
import { writeFileSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const hooksDir = join(process.cwd(), '.git', 'hooks')
const hookPath = join(hooksDir, 'pre-commit')

if (!existsSync(hooksDir)) {
  console.error('Error: .git/hooks directory not found — are you in the repo root?')
  process.exit(1)
}

const hookScript = `#!/usr/bin/env sh
npx lint-staged
`

writeFileSync(hookPath, hookScript, 'utf8')
try {
  chmodSync(hookPath, 0o755)
} catch {
  // chmod not available on Windows — Git for Windows uses the shebang anyway
}

console.log('pre-commit hook installed at .git/hooks/pre-commit')
console.log('Staged files will be auto-formatted before each commit.')

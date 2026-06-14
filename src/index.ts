#!/usr/bin/env node

import { failCommand } from './cli/output.js'
import { runCli } from './cli/run-cli.js'

runCli().catch((error) => {
  failCommand(error instanceof Error ? error.message : String(error))
})

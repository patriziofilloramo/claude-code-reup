import { exec } from 'node:child_process'
import { createServer } from 'node:net'

import { serve } from '@hono/node-server'

import { APP } from '../config/app.js'
import { log } from '../utils/logger.js'
import { buildApp } from './routes.js'

// -----------------------------------------------------------------------------
// Port selection
// -----------------------------------------------------------------------------

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probeServer = createServer()
    probeServer.once('error', () => resolve(false))
    probeServer.once('listening', () => {
      probeServer.close(() => resolve(true))
    })
    probeServer.listen(port)
  })
}

async function findAvailablePort(startingPort: number): Promise<number> {
  for (
    let candidatePort = startingPort;
    candidatePort < startingPort + APP.portSearchRange;
    candidatePort++
  ) {
    if (await isPortAvailable(candidatePort)) return candidatePort
  }
  // Preserve the preferred port so the HTTP server surfaces the final bind error.
  return startingPort
}

// -----------------------------------------------------------------------------
// Browser launch
// -----------------------------------------------------------------------------

function openBrowser(url: string): void {
  const command =
    process.platform === 'win32'
      ? `powershell -Command "Start-Process '${url}'"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`
  exec(command)
}

// -----------------------------------------------------------------------------
// Server lifecycle
// -----------------------------------------------------------------------------

/** Starts the loopback-only web server and opens its browser client. */
export async function startWeb(commandArguments: string[]): Promise<void> {
  const { initCloudSync } = await import('../core/sync/cloud-sync.js')
  await initCloudSync()
  const requestedPort = parseRequestedPort(commandArguments)
  const configuredPort = process.env[APP.portEnvVar]
  const preferredPort = configuredPort ? parseInt(configuredPort, 10) : requestedPort
  const port = await findAvailablePort(preferredPort)
  const url = `http://localhost:${port}`

  serve({ fetch: buildApp().fetch, hostname: '127.0.0.1', port })

  log.info(`ccm web  →  ${url}`)
  log.info('Press Ctrl+C to stop.')

  if (!process.env[APP.noOpenEnvVar]) openBrowser(url)
}

function parseRequestedPort(commandArguments: string[]): number {
  const portFlagIndex = commandArguments.indexOf('--port')
  return portFlagIndex >= 0
    ? parseInt(commandArguments[portFlagIndex + 1] ?? String(APP.defaultPort), 10)
    : APP.defaultPort
}

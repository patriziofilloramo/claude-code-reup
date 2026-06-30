import { execFile } from 'node:child_process'
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
    probeServer.listen(port, '127.0.0.1')
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
  const [command, args] =
    process.platform === 'win32'
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  execFile(command, args, (error) => {
    if (error) log.warn('browser open failed:', error.message)
  })
}

// -----------------------------------------------------------------------------
// Server lifecycle
// -----------------------------------------------------------------------------

/** Starts the loopback-only web server and opens its browser client. */
export async function startWeb(commandArguments: string[]): Promise<void> {
  const { initCloudSync } = await import('../core/sync/cloud-sync.js')
  await initCloudSync()
  const requestedPort = parseRequestedPort(commandArguments)
  const configuredPort = process.env[APP.portEnvVar] ?? process.env[APP.legacyPortEnvVar]
  const preferredPort = configuredPort ? parsePort(configuredPort, requestedPort) : requestedPort
  const port = await findAvailablePort(preferredPort)
  const url = `http://localhost:${port}`

  serve({ fetch: buildApp().fetch, hostname: '127.0.0.1', port })

  log.info(`reup web  →  ${url}`)
  log.info('Press Ctrl+C to stop.')

  if (!(process.env[APP.noOpenEnvVar] ?? process.env[APP.legacyNoOpenEnvVar])) openBrowser(url)
}

function parseRequestedPort(commandArguments: string[]): number {
  const portFlagIndex = commandArguments.indexOf('--port')
  return portFlagIndex >= 0
    ? parsePort(commandArguments[portFlagIndex + 1], APP.defaultPort)
    : APP.defaultPort
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback
}

import { execFile } from 'node:child_process'
import { createServer } from 'node:net'

import { serve } from '@hono/node-server'

import { APP } from '../config/app.js'
import { log } from '../utils/logger.js'
import { buildApp } from './routes.js'

export const WEB_BIND_HOST = '127.0.0.1'
const WEB_BROWSER_HOST = 'localhost'

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
    probeServer.listen(port, WEB_BIND_HOST)
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
  const { args, command } = browserOpenCommand(url)
  execFile(command, args, (error) => {
    if (error) log.warn('browser open failed:', error.message)
  })
}

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform
): { args: string[]; command: string } {
  if (platform === 'win32') {
    return {
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process', url],
      command: 'powershell.exe',
    }
  }
  if (platform === 'darwin') return { args: [url], command: 'open' }
  return { args: [url], command: 'xdg-open' }
}

// -----------------------------------------------------------------------------
// Server lifecycle
// -----------------------------------------------------------------------------

/** Starts the loopback-only web server and opens its browser client. */
export async function startWeb(commandArguments: string[]): Promise<void> {
  const requestedPort = parseRequestedPort(commandArguments)
  const configuredPort = process.env[APP.portEnvVar] ?? process.env[APP.legacyPortEnvVar]
  const preferredPort = configuredPort ? parseWebPort(configuredPort, requestedPort) : requestedPort
  const port = await findAvailablePort(preferredPort)
  const url = `http://${WEB_BROWSER_HOST}:${port}`

  serve({ fetch: buildApp().fetch, hostname: WEB_BIND_HOST, port })

  log.info(`reup web  →  ${url}`)
  log.info('Press Ctrl+C to stop.')

  if (!(process.env[APP.noOpenEnvVar] ?? process.env[APP.legacyNoOpenEnvVar])) openBrowser(url)
}

function parseRequestedPort(commandArguments: string[]): number {
  const portFlagIndex = commandArguments.indexOf('--port')
  return portFlagIndex >= 0
    ? parseWebPort(commandArguments[portFlagIndex + 1], APP.defaultPort)
    : APP.defaultPort
}

export function parseWebPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback
}

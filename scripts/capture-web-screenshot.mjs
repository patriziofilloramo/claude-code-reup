import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { fileURLToPath, URL } from 'node:url'

import WebSocket from 'ws'

const CAPTURE_TIMEOUT_MS = 20_000
const READY_EXPRESSION = `
  document.readyState === 'complete' &&
  !document.querySelector('#reup-loading') &&
  !document.body.classList.contains('link-lost') &&
  document.querySelectorAll('.proj-row').length >= 3 &&
  document.querySelectorAll('.rail-live-item').length >= 3 &&
  (
    document.querySelectorAll('.sess-row').length >= 4 ||
    (
      document.body.classList.contains('session-details-expanded') &&
      document.querySelector('.sess-inspector')?.style.display !== 'none'
    )
  )
`

/** Captures a stable, fully rendered Reup dashboard through Chromium's DevTools protocol. */
export async function captureWebScreenshot({ debugPort, outputPath, url }) {
  const targetUrl = validateLoopbackUrl(url)
  const port = validatePort(debugPort)
  const destination = validateOutputPath(outputPath)
  const target = await waitForPageTarget(port)
  const client = await DevToolsClient.connect(target.webSocketDebuggerUrl)

  try {
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: 1020,
      mobile: false,
      width: 1840,
    })
    await client.send('Page.navigate', { url: targetUrl.href })
    await waitForDashboard(client)
    await client.send('Runtime.evaluate', {
      expression: `
        (() => {
          const style = document.createElement('style')
          style.dataset.reupCapture = 'true'
          style.textContent = '* { animation: none !important; caret-color: transparent !important; transition: none !important; }'
          document.head.appendChild(style)
          window.scrollTo(0, 0)
        })()
      `,
    })
    await delay(250)

    const result = await client.send('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png',
      fromSurface: true,
    })
    if (typeof result.data !== 'string' || result.data.length === 0) {
      throw new Error('Chromium returned an empty screenshot')
    }
    await writeFile(destination, Buffer.from(result.data, 'base64'))
    return destination
  } finally {
    client.close()
  }
}

class DevToolsClient {
  #nextId = 1
  #pending = new Map()
  #socket

  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl)
    await new Promise((resolveConnection, rejectConnection) => {
      const timer = setTimeout(
        () => rejectConnection(new Error('Timed out connecting to Chromium DevTools')),
        CAPTURE_TIMEOUT_MS
      )
      socket.once('open', () => {
        clearTimeout(timer)
        resolveConnection()
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        rejectConnection(error)
      })
    })
    return new DevToolsClient(socket)
  }

  constructor(socket) {
    this.#socket = socket
    socket.on('message', (data) => this.#handleMessage(data))
    socket.on('close', () => this.#rejectPending(new Error('Chromium DevTools disconnected')))
    socket.on('error', (error) => this.#rejectPending(error))
  }

  close() {
    this.#socket.close()
  }

  send(method, params = {}) {
    const id = this.#nextId++
    return new Promise((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        rejectCommand(new Error(`Timed out waiting for ${method}`))
      }, CAPTURE_TIMEOUT_MS)
      this.#pending.set(id, { rejectCommand, resolveCommand, timer })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  #handleMessage(data) {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }
    if (!Number.isInteger(message.id)) return
    const pending = this.#pending.get(message.id)
    if (!pending) return

    this.#pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) {
      pending.rejectCommand(new Error(message.error.message ?? 'Chromium DevTools command failed'))
    } else {
      pending.resolveCommand(message.result ?? {})
    }
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.rejectCommand(error)
    }
    this.#pending.clear()
  }
}

async function waitForDashboard(client) {
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS
  let lastState = null
  while (Date.now() < deadline) {
    const evaluation = await client.send('Runtime.evaluate', {
      expression: `
        ({
          bodyClass: document.body?.className ?? '',
          loading: Boolean(document.querySelector('#reup-loading')),
          liveRows: document.querySelectorAll('.rail-live-item').length,
          projectRows: document.querySelectorAll('.proj-row').length,
          ready: Boolean(${READY_EXPRESSION}),
          sessionRows: document.querySelectorAll('.sess-row').length,
          url: location.href
        })
      `,
      returnByValue: true,
    })
    lastState = evaluation.result?.value ?? null
    if (lastState?.ready === true) return
    await delay(200)
  }
  throw new Error(
    `Dashboard did not reach the expected synthetic ready state: ${JSON.stringify(lastState)}`
  )
}

async function waitForPageTarget(debugPort) {
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await globalThis.fetch(`http://127.0.0.1:${debugPort}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const target = Array.isArray(targets)
          ? targets.find(
              (candidate) =>
                candidate?.type === 'page' && typeof candidate.webSocketDebuggerUrl === 'string'
            )
          : null
        if (target) return target
      }
    } catch {
      // Chromium may still be starting; retry until the bounded deadline.
    }
    await delay(200)
  }
  throw new Error('Chromium DevTools endpoint did not become ready')
}

function validateLoopbackUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) {
    throw new Error('--url must use HTTP on the local loopback interface')
  }
  return url
}

function validateOutputPath(value) {
  if (typeof value !== 'string' || !value.toLowerCase().endsWith('.png')) {
    throw new Error('--output must be a PNG path')
  }
  return isAbsolute(value) ? value : resolve(value)
}

function validatePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('--debug-port must be a valid TCP port')
  }
  return port
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function readArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--debug-port') options.debugPort = argv[++index]
    else if (argument === '--output') options.outputPath = argv[++index]
    else if (argument === '--url') options.url = argv[++index]
    else throw new Error(`unknown argument: ${argument}`)
  }
  return options
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const destination = await captureWebScreenshot(readArguments(process.argv.slice(2)))
    console.log(`Captured synthetic Reup dashboard: ${destination}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

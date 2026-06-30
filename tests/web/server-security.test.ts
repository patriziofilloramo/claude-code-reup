import { describe, expect, it } from 'vitest'

import { browserOpenCommand, parseWebPort, WEB_BIND_HOST } from '../../src/web/server.js'

describe('web server security and startup guardrails', () => {
  it('binds the web server to IPv4 loopback only', () => {
    expect(WEB_BIND_HOST).toBe('127.0.0.1')
  })

  it('opens the browser through argv-based platform commands', () => {
    const url = 'http://localhost:3333'

    expect(browserOpenCommand(url, 'win32')).toEqual({
      args: ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process', url],
      command: 'powershell.exe',
    })
    expect(browserOpenCommand(url, 'darwin')).toEqual({ args: [url], command: 'open' })
    expect(browserOpenCommand(url, 'linux')).toEqual({ args: [url], command: 'xdg-open' })
  })

  it('validates configured web ports before binding', () => {
    expect(parseWebPort('3333', 4444)).toBe(3333)

    for (const invalidPort of [undefined, '', '0', '-1', '65536', '12.5', 'not-a-port']) {
      expect(parseWebPort(invalidPort, 4444)).toBe(4444)
    }
  })
})

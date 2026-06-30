import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const SERVER_PATH = join(process.cwd(), 'src', 'web', 'server.ts')

describe('web server security and startup guardrails', () => {
  it('opens the browser without shell interpolation and probes only loopback', async () => {
    const source = await readFile(SERVER_PATH, 'utf8')

    expect(source).toContain("import { execFile } from 'node:child_process'")
    expect(source).not.toContain("import { exec } from 'node:child_process'")
    expect(source).not.toContain('exec(command)')
    expect(source).toContain("probeServer.listen(port, '127.0.0.1')")
    expect(source).toContain("serve({ fetch: buildApp().fetch, hostname: '127.0.0.1', port })")
  })

  it('validates configured web ports before binding', async () => {
    const source = await readFile(SERVER_PATH, 'utf8')

    expect(source).toContain('function parsePort(')
    expect(source).toContain('Number.isInteger(parsed)')
    expect(source).toContain('parsed > 0 && parsed <= 65_535')
  })
})

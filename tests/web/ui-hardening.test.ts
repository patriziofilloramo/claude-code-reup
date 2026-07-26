import { beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildHtml } from '../../src/web/ui.js'

const CLIENT_PATH = join(process.cwd(), 'src', 'web', 'client.js')
const DIAGNOSTICS_DRAWER_PATH = join(
  process.cwd(),
  'src',
  'web',
  'client',
  '11-diagnostics-drawer.js'
)

/** A directory name is a legal place for markup on Linux and macOS. */
const HOSTILE_PROJECT_PATH = `/tmp/victim<img src=x onerror=alert(1)>'"`

describe('web UI hardening', () => {
  let clientBundle: string
  let diagnosticsDrawer: string

  beforeAll(async () => {
    const files = await Promise.all([
      readFile(CLIENT_PATH, 'utf8'),
      readFile(DIAGNOSTICS_DRAWER_PATH, 'utf8'),
    ])
    clientBundle = files[0]
    diagnosticsDrawer = files[1]
  })

  /** Lifts a standalone helper out of the built bundle so it can be exercised directly. */
  function clientFunction(name: string): (...args: unknown[]) => string {
    const declaration = new RegExp(`^function ${name}\\([\\s\\S]*?^}`, 'm').exec(clientBundle)
    expect(declaration, `${name} must exist in the built client bundle`).not.toBeNull()
    return new Function(`${declaration?.[0] ?? ''}; return ${name};`)() as (
      ...args: unknown[]
    ) => string
  }

  // ---------------------------------------------------------------------------
  // Transcript-derived values reaching innerHTML
  // ---------------------------------------------------------------------------

  describe('escaping of transcript-derived values', () => {
    it('neutralises markup a project path can legally contain', () => {
      const escapeHtml = clientFunction('escapeHtml')

      const escaped = escapeHtml(HOSTILE_PROJECT_PATH)

      expect(escaped).not.toContain('<')
      expect(escaped).not.toContain('>')
      expect(escaped).not.toContain('"')
      // Single quotes too, so the helper stays correct inside single-quoted
      // attributes as well as the double-quoted ones the UI uses today.
      expect(escaped).not.toContain("'")
    })

    it('does not escape on its own during placeholder substitution', () => {
      const fmt = clientFunction('fmt')

      // Pinned so nobody assumes fmt() is safe to drop into innerHTML: it is
      // substitution only, and every call site must escape its result.
      expect(fmt('Path missing · {path}', { path: '<b>' })).toBe('Path missing · <b>')
    })

    it('renders a hostile project path inert once composed as the drawer does', () => {
      const escapeHtml = clientFunction('escapeHtml')
      const fmt = clientFunction('fmt')

      const rendered = escapeHtml(fmt('Path missing · {path}', { path: HOSTILE_PROJECT_PATH }))

      expect(rendered).not.toMatch(/<[a-z]/i)
      expect(rendered).toContain('&lt;img')
    })

    it('escapes every project path the Lost & Found panel writes into innerHTML', () => {
      const interpolations = diagnosticsDrawer
        .split('\n')
        .filter((line) => /\b[a-z]\.projectPath\b/.test(line))

      expect(interpolations.length).toBeGreaterThan(0)
      for (const line of interpolations) {
        expect(line, `unescaped project path: ${line.trim()}`).toContain('escapeHtml(')
      }
    })
  })

  // ---------------------------------------------------------------------------
  // Content-Security-Policy
  // ---------------------------------------------------------------------------

  describe('content security policy', () => {
    function contentSecurityPolicy(html: string): string {
      const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)
      expect(meta, 'the page must declare a CSP').not.toBeNull()
      return meta?.[1] ?? ''
    }

    it('authorises the application script by nonce, and only by nonce', () => {
      const html = buildHtml('dark')
      const policy = contentSecurityPolicy(html)

      const nonce = /script-src 'nonce-([^']+)'/.exec(policy)?.[1]
      expect(nonce).toBeTruthy()
      expect(html).toContain(`<script nonce="${String(nonce)}">`)
      expect(policy).toContain("default-src 'none'")
      expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/)
      expect(policy).not.toMatch(/script-src[^;]*unsafe-eval/)
    })

    it('mints a fresh nonce for every render', () => {
      const first = contentSecurityPolicy(buildHtml('dark'))
      const second = contentSecurityPolicy(buildHtml('dark'))

      expect(first).not.toBe(second)
    })

    it('leaves no nonce placeholder in the served document', () => {
      expect(buildHtml('dark')).not.toContain('__REUP_NONCE__')
    })

    it('keeps inline style attributes working by not putting a nonce on style-src', () => {
      // A nonce in style-src makes the browser ignore 'unsafe-inline', which
      // would break every style="" attribute the UI renders.
      const policy = contentSecurityPolicy(buildHtml('dark'))

      expect(policy).toMatch(/style-src[^;]*'unsafe-inline'/)
      expect(policy).not.toMatch(/style-src[^;]*nonce-/)
    })
  })

  // ---------------------------------------------------------------------------
  // Theme attribute
  // ---------------------------------------------------------------------------

  describe('theme attribute', () => {
    it('applies a known theme', () => {
      expect(buildHtml('terminal')).toContain('data-theme="terminal"')
    })

    it('falls back to the default rather than trusting a hand-edited preference', () => {
      expect(buildHtml('"><script>alert(1)</script>')).toContain('data-theme="dark"')
      expect(buildHtml('toString')).toContain('data-theme="dark"')
    })
  })
})

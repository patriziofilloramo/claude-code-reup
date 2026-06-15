import type { Hono } from 'hono'

import type { ThemeName } from '../../config/theme-tokens.js'
import { THEMES } from '../../config/themes/index.js'
import { saveThemeName } from '../../core/theme-preference.js'

export function registerThemeRoute(app: Hono): void {
  app.post('/api/theme', async (c) => {
    const body = await c.req.json<{ name?: string }>()
    const name = body.name
    if (!name || !(name in THEMES)) {
      return c.json({ error: `invalid theme — valid values: ${Object.keys(THEMES).join(', ')}` }, 400)
    }
    saveThemeName(name as ThemeName)
    return c.json({ ok: true })
  })
}

import type { Hono } from 'hono'

import type { ThemeName } from '../../config/theme-tokens.js'
import { THEMES } from '../../config/themes/index.js'
import { saveThemeName } from '../../core/theme-preference.js'
import { guardedRoute } from './route-helper.js'

export function registerThemeRoute(app: Hono): void {
  app.post(
    '/api/theme',
    guardedRoute(async (context) => {
      const body = await context.req.json<{ name?: unknown }>()
      const name = body.name
      if (typeof name !== 'string' || !Object.hasOwn(THEMES, name)) {
        return context.json(
          { error: `invalid theme — valid values: ${Object.keys(THEMES).join(', ')}` },
          400
        )
      }
      await saveThemeName(name as ThemeName)
      return context.json({ ok: true })
    })
  )
}

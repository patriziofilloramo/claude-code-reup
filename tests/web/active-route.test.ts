import { describe, expect, it, vi } from 'vitest'

const liveActivityMocks = vi.hoisted(() => ({
  buildLiveActivitySnapshot: vi.fn(async () => ({
    activeSessionIds: [],
    entries: [],
  })),
  readPresentableActiveSessionIds: vi.fn(async () => ['presentable-session']),
}))

vi.mock('../../src/web/live-activity-model.js', () => liveActivityMocks)

import { buildApp } from '../../src/web/routes.js'

describe('GET /api/active', () => {
  it('uses the lightweight presentable-activity model', async () => {
    const response = await buildApp().request('/api/active')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ sessionIds: ['presentable-session'] })
    expect(liveActivityMocks.readPresentableActiveSessionIds).toHaveBeenCalledWith({
      officialRefresh: 'background',
    })
  })
})

import { describe, expect, it } from 'vitest'

import MarkdownIt from '../../extension/node_modules/markdown-it/index.mjs'
import { buildPackagedReadme } from '../../extension/scripts/marketplace-readme.mjs'

describe('packaged extension marketplace README', () => {
  it('embeds both product visuals without private or relative URLs', async () => {
    const readme = await buildPackagedReadme()

    expect(readme).toContain('data:image/gif;base64,R0lGOD')
    expect(readme).toContain('data:image/png;base64,iVBOR')
    expect(readme).not.toContain('media/marketplace/')
    expect(readme).not.toContain('raw.githubusercontent.com')
    expect(readme).toContain('Stop hunting for the right Claude session')

    const html = new MarkdownIt().render(readme)
    expect(html).toContain('<img src="data:image/gif;base64,')
    expect(html).toContain('<img src="data:image/png;base64,')
  })
})

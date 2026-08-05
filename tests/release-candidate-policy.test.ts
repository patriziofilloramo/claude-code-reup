import { describe, expect, it } from 'vitest'

import { validateVsixCandidate, validateVsixManifestXml } from '../scripts/check-vsix.mjs'
import { releaseTreeMutationError } from '../scripts/release-tree-state.mjs'

const requiredVsixEntries = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/dist/extension.cjs',
  'extension/dist/extension.cjs.map',
  'extension/media/reup-brand.png',
  'extension/media/reup-brand.svg',
  'extension/media/reup.svg',
  'extension/package.json',
  'extension/readme.md',
]

describe('release candidate integrity policy', () => {
  it('rejects generated changes after a clean release starts', () => {
    expect(releaseTreeMutationError(false, '', 'the release gate')).toBeNull()
    expect(releaseTreeMutationError(true, ' M src/web/client.js', 'the release gate')).toBeNull()
    expect(releaseTreeMutationError(false, ' M src/web/client.js', 'the release gate')).toContain(
      'previously clean working tree'
    )
  })

  it('accepts the minimal packaged VSIX contract', () => {
    expect(
      validateVsixCandidate(
        requiredVsixEntries,
        {
          activationEvents: ['onCommand:reup.openDashboard'],
          engines: { vscode: '^1.90.0' },
          main: './dist/extension.cjs',
          name: 'reup-vscode',
          publisher: 'reup-local',
          version: '0.4.0',
        },
        {
          name: 'reup-vscode',
          publisher: 'reup-local',
          version: '0.4.0',
          vscodeEngine: '^1.90.0',
        }
      )
    ).toEqual([])
  })

  it('rejects source leakage and a mismatched VSIX identity', () => {
    const errors = validateVsixCandidate(
      [
        ...requiredVsixEntries.filter((entry) => entry !== 'extension/dist/extension.cjs'),
        'extension/src/private.ts',
      ],
      {
        activationEvents: [],
        engines: { vscode: '^1.80.0' },
        main: './src/extension.ts',
        name: 'other-extension',
        publisher: 'other-publisher',
        version: '0.3.0',
      },
      {
        name: 'reup-vscode',
        publisher: 'reup-local',
        version: '0.4.0',
        vscodeEngine: '^1.90.0',
      }
    )

    expect(errors).toEqual(
      expect.arrayContaining([
        'VSIX is missing extension/dist/extension.cjs.',
        'VSIX includes forbidden path extension/src/private.ts.',
        'VSIX extension name other-extension does not match reup-vscode.',
        'VSIX extension version 0.3.0 does not match 0.4.0.',
        'VSIX extension publisher other-publisher does not match reup-local.',
        'VSIX extension main must point to ./dist/extension.cjs.',
        'VSIX VS Code engine ^1.80.0 does not match ^1.90.0.',
        'VSIX extension must declare activation events.',
      ])
    )
  })

  it('validates the generated VSIX identity manifest', () => {
    const expected = {
      name: 'reup-vscode',
      publisher: 'reup-local',
      version: '0.4.0',
    }
    const manifest = `<?xml version="1.0"?>
      <PackageManifest>
        <Identity Id="reup-vscode" Version="0.4.0" Publisher="reup-local" />
        <InstallationTarget Id="Microsoft.VisualStudio.Code" />
        <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" />
      </PackageManifest>`

    expect(validateVsixManifestXml(manifest, expected)).toEqual([])
    expect(
      validateVsixManifestXml(
        manifest
          .replace('Version="0.4.0"', 'Version="0.3.0"')
          .replace('Path="extension/package.json"', 'Path="extension/missing.json"'),
        expected
      )
    ).toEqual(
      expect.arrayContaining([
        'VSIX manifest version 0.3.0 does not match 0.4.0.',
        'VSIX manifest must reference extension/package.json as its code manifest.',
      ])
    )
  })

  it('rejects duplicate, unsafe, and unexpected VSIX archive paths', () => {
    const entries = [
      ...requiredVsixEntries,
      'extension/media/reup.svg',
      '../outside.txt',
      'extension/credentials.json',
    ]

    const errors = validateVsixCandidate(
      entries,
      {
        activationEvents: ['onCommand:reup.openDashboard'],
        engines: { vscode: '^1.90.0' },
        main: './dist/extension.cjs',
        name: 'reup-vscode',
        publisher: 'reup-local',
        version: '0.4.0',
      },
      {
        name: 'reup-vscode',
        publisher: 'reup-local',
        version: '0.4.0',
        vscodeEngine: '^1.90.0',
      }
    )

    expect(errors).toEqual(
      expect.arrayContaining([
        'VSIX contains duplicate archive paths.',
        'VSIX includes unsafe path ../outside.txt.',
        'VSIX includes unexpected path extension/credentials.json.',
      ])
    )
  })
})

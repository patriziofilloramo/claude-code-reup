import { describe, expect, it } from 'vitest'

import { formatDoctorReport } from '../../src/cli/doctor-command.js'
import type { DiagnosticsReport } from '../../src/core/health/diagnostics.js'

function emptyReport(): DiagnosticsReport {
  return {
    brokenIndices: [],
    expiring: [],
    legacyProjectMemoryArtifacts: [],
    orphanedAttentionMarkers: [],
    orphanedTranscripts: [],
    pathMissing: [],
    staleLocks: [],
  }
}

describe('formatDoctorReport', () => {
  it('prints a clear healthy result', () => {
    expect(formatDoctorReport(emptyReport())).toBe(
      'Reup Doctor\nLocal session-data health check\n\nOK  No issues found.'
    )
  })

  it('groups non-destructive diagnostics by issue type', () => {
    const report = emptyReport()
    report.brokenIndices.push({
      path: '/claude/projects/project/sessions-index.json',
      projectId: 'project',
      reason: 'index contains invalid JSON',
    })
    report.staleLocks.push({
      path: '/claude/projects/project/reup.json.lock',
      projectId: 'project',
      reason: 'owner process 999 is not running',
    })
    report.orphanedTranscripts.push({
      projectId: 'project',
      projectPath: '/workspace',
      sessionId: '00000000-0000-0000-0000-000000000001',
    })
    report.legacyProjectMemoryArtifacts.push({
      kind: 'link-marker',
      path: '/claude/projects/project/.reup-link',
      projectId: 'project',
    })
    report.expiring.push({
      context: {
        latestContextTokens: null,
        latestModel: null,
        latestOutputTokens: null,
        models: [],
      },
      created: '2026-06-11T00:00:00.000Z',
      id: '10000000-0000-0000-0000-000000000001',
      messageCount: 4,
      name: 'Review release',
      primaryStatus: 'expiring',
      projectId: 'project',
      projectPath: '/workspace',
      signals: {
        analysisComplete: true,
        archived: false,
        compactionCount: 0,
        expiresInDays: 2,
        interrupted: false,
        lastToolFailed: false,
        pathExists: true,
      },
      updated: '2026-06-11T00:00:00.000Z',
    })

    const output = formatDoctorReport(report)

    expect(output).toContain('Reup Doctor')
    expect(output).toContain('5 findings')
    expect(output).toContain('Broken session indices (1)')
    expect(output).toContain('Stale sidecar locks (1)')
    expect(output).toContain('Orphaned transcripts (1)')
    expect(output).toContain('Legacy Project Memory artifacts (1)')
    expect(output).toContain('Sessions nearing Claude cleanup (1)')
    expect(output).toContain('Why:  This release no longer manages Project Memory artifacts.')
    expect(output).toContain('Next: Leave them alone unless sessions are missing')
    expect(output).toContain('2d remaining')
  })

  it('does not claim "0d remaining" when the expiry signal is unknown', () => {
    const report = emptyReport()
    report.expiring.push({
      context: {
        latestContextTokens: null,
        latestModel: null,
        latestOutputTokens: null,
        models: [],
      },
      created: '2026-06-11T00:00:00.000Z',
      id: '10000000-0000-0000-0000-000000000001',
      messageCount: 4,
      name: 'Review release',
      primaryStatus: 'expiring',
      projectId: 'project',
      projectPath: '/workspace',
      signals: {
        analysisComplete: true,
        archived: false,
        compactionCount: 0,
        expiresInDays: null,
        interrupted: false,
        lastToolFailed: false,
        pathExists: true,
      },
      updated: '2026-06-11T00:00:00.000Z',
    })

    const output = formatDoctorReport(report)

    expect(output).not.toContain('0d remaining')
    expect(output).toContain('expiry unknown')
  })
})

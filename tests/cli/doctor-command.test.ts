import { describe, expect, it } from 'vitest'

import { formatDoctorReport } from '../../src/cli/doctor-command.js'
import type { DiagnosticsReport } from '../../src/core/health/diagnostics.js'

function emptyReport(): DiagnosticsReport {
  return {
    brokenIndices: [],
    expiring: [],
    orphanedTranscripts: [],
    pathMissing: [],
    staleLocks: [],
  }
}

describe('formatDoctorReport', () => {
  it('prints a clear healthy result', () => {
    expect(formatDoctorReport(emptyReport())).toBe('CCM Doctor\n\nNo issues found.')
  })

  it('groups non-destructive diagnostics by issue type', () => {
    const report = emptyReport()
    report.brokenIndices.push({
      path: '/claude/projects/project/sessions-index.json',
      projectId: 'project',
      reason: 'index contains invalid JSON',
    })
    report.staleLocks.push({
      path: '/claude/projects/project/ccm.json.lock',
      projectId: 'project',
      reason: 'owner process 999 is not running',
    })
    report.orphanedTranscripts.push({
      projectId: 'project',
      projectPath: '/workspace',
      sessionId: '00000000-0000-0000-0000-000000000001',
    })

    const output = formatDoctorReport(report)

    expect(output).toContain('CCM Doctor · 3 issues')
    expect(output).toContain('Broken session indices (1)')
    expect(output).toContain('Stale sidecar locks (1)')
    expect(output).toContain('Orphaned transcripts (1)')
    expect(output).toContain('CCM falls back to readable transcripts')
  })
})

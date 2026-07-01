export type FeatureSurface = 'tui' | 'vscode' | 'web'
export type FeatureSurfaceStatus = 'implemented' | 'partial' | 'planned' | 'not-planned'

export interface FeatureSurfaceDefinition {
  description: string
  surfaces: Record<FeatureSurface, FeatureSurfaceStatus>
}

/**
 * Product capability matrix. This is a planning and CI guardrail only; runtime
 * registration remains owned by each surface.
 */
export const FEATURE_SURFACES = {
  sessionBrowse: {
    description: 'Browse projects and Claude Code sessions',
    surfaces: { tui: 'implemented', vscode: 'implemented', web: 'implemented' },
  },
  resume: {
    description: 'Resume a session in its recorded project',
    surfaces: { tui: 'implemented', vscode: 'implemented', web: 'implemented' },
  },
  resumeAdvice: {
    description: 'Explain whether and how a session should be resumed',
    surfaces: { tui: 'planned', vscode: 'implemented', web: 'planned' },
  },
  sessionPreview: {
    description: 'Show structured goal, progress, plan, TODO, and file context',
    surfaces: { tui: 'implemented', vscode: 'implemented', web: 'implemented' },
  },
  handoff: {
    description: 'Create a transcript-supported continuation packet',
    surfaces: { tui: 'implemented', vscode: 'implemented', web: 'implemented' },
  },
  safeSessionMetadata: {
    description: 'Edit aliases, archive state, and tags',
    surfaces: { tui: 'partial', vscode: 'implemented', web: 'implemented' },
  },
  deepSearch: {
    description: 'Search transcript content',
    surfaces: { tui: 'implemented', vscode: 'planned', web: 'implemented' },
  },
  organization: {
    description: 'Organize work with groups, stacks, and tags',
    surfaces: { tui: 'partial', vscode: 'partial', web: 'implemented' },
  },
  liveUsage: {
    description: 'Show context and account usage state',
    surfaces: { tui: 'implemented', vscode: 'partial', web: 'implemented' },
  },
  attentionAlerts: {
    description: 'Alert when a session waits for user input or finishes a turn',
    surfaces: { tui: 'implemented', vscode: 'planned', web: 'implemented' },
  },
} as const satisfies Record<string, FeatureSurfaceDefinition>

export type FeatureId = keyof typeof FEATURE_SURFACES

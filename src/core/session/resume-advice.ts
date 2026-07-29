import type { Session } from './session-model.js'

export type ResumeAdviceCode =
  | 'path-missing'
  | 'already-active'
  | 'branch-drift'
  | 'interrupted'
  | 'expiring'
  | 'heavily-compacted'
  | 'ready'

export type ResumeAdviceSeverity = 'info' | 'warning' | 'blocked'
export type ResumeRecommendedAction = 'resume' | 'handoff' | 'inspect' | 'none'

export interface ResumeAdvice {
  code: ResumeAdviceCode
  explanation: string
  recommendedAction: ResumeRecommendedAction
  severity: ResumeAdviceSeverity
  title: string
}

/**
 * Converts independent session facts into one deterministic recommendation.
 * The helper never performs the recommendation: every surface keeps the user
 * in control of branch changes, resume, handoff, and recovery.
 */
export function getResumeAdvice(session: Session, isActive: boolean): ResumeAdvice {
  if (!session.signals.pathExists) {
    return {
      code: 'path-missing',
      explanation: `The recorded project path is unavailable: ${session.projectPath}`,
      recommendedAction: 'none',
      severity: 'blocked',
      title: 'Project path missing',
    }
  }

  if (isActive) {
    return {
      code: 'already-active',
      explanation: 'Claude Code already has a live process attached to this session.',
      recommendedAction: 'inspect',
      severity: 'blocked',
      title: 'Session already active',
    }
  }

  if (session.gitBranch && session.currentBranch && session.gitBranch !== session.currentBranch) {
    return {
      code: 'branch-drift',
      explanation: `The session recorded "${session.gitBranch}", while the project is currently on "${session.currentBranch}". Verify the branch before resuming.`,
      recommendedAction: 'inspect',
      severity: 'warning',
      title: 'Branch changed',
    }
  }

  if (session.signals.interruptedByUser === true) {
    return {
      code: 'interrupted',
      explanation: 'You stopped Claude mid-turn and have not given it new instructions since.',
      recommendedAction: 'resume',
      severity: 'warning',
      title: 'Continue interrupted work',
    }
  }

  if (session.signals.interrupted === true || session.signals.lastToolFailed === true) {
    return {
      code: 'interrupted',
      explanation:
        'The previous run ended with unfinished or failed tool work. Resume to inspect and complete it.',
      recommendedAction: 'resume',
      severity: 'warning',
      title: 'Continue interrupted work',
    }
  }

  if (session.signals.expiresInDays !== null && session.signals.expiresInDays <= 5) {
    return {
      code: 'expiring',
      explanation: `Claude Code may clean up this transcript in ${session.signals.expiresInDays} day${session.signals.expiresInDays === 1 ? '' : 's'}. Resume or create a handoff soon.`,
      recommendedAction: 'handoff',
      severity: 'warning',
      title: 'Session nearing cleanup',
    }
  }

  if (session.signals.compactionCount !== null && session.signals.compactionCount >= 3) {
    return {
      code: 'heavily-compacted',
      explanation:
        'This session has been compacted repeatedly. A handoff into a fresh session will usually preserve clarity.',
      recommendedAction: 'handoff',
      severity: 'warning',
      title: 'Fresh session recommended',
    }
  }

  return {
    code: 'ready',
    explanation:
      'The project path and branch context are consistent. This session is ready to resume.',
    recommendedAction: 'resume',
    severity: 'info',
    title: 'Ready to resume',
  }
}

import { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'

import { LABELS } from '../../config/labels.js'
import { COLORS } from '../../config/theme.js'
import { getSessionLockInfo } from '../../core/session/active-sessions.js'
import type { SessionLockInfo } from '../../core/session/active-sessions.js'
import type { Session } from '../../core/session/session-model.js'
import type {
  NativeTodoItem,
  NativeTodoState,
} from '../../core/session/session-automatic-context.js'
import { primaryStatus } from '../../core/session/session-signals.js'
import { loadSessionPreview, sessionTranscriptPath } from '../../core/session/session-preview.js'
import type { SessionPreview } from '../../core/session/session-preview.js'
import { relativeTime } from '../../utils/time.js'
import { projectPanelWidthForTerminal } from '../layout.js'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ResumeCardProps {
  isActive: boolean
  projectId: string
  session: Session
  onResume: () => void
  onClose: () => void
}

export default function ResumeCard({
  isActive,
  projectId,
  session,
  onResume,
  onClose,
}: ResumeCardProps) {
  const { stdout } = useStdout()
  const [preview, setPreview] = useState<SessionPreview | null>(null)
  const [lockInfo, setLockInfo] = useState<SessionLockInfo | null>(null)
  const [filesExpanded, setFilesExpanded] = useState(false)

  useEffect(() => {
    const path = sessionTranscriptPath(projectId, session.id)
    void loadSessionPreview(path).then(setPreview)
  }, [projectId, session.id])

  useEffect(() => {
    if (!isActive) {
      setLockInfo(null)
      return
    }
    void getSessionLockInfo(session.id).then(setLockInfo)
  }, [isActive, session.id])

  useInput((input, key) => {
    if (key.return) {
      onResume()
      return
    }
    if (key.escape || input === '\x1b') {
      onClose()
      return
    }
    if (input === 'f' && preview && preview.touchedFiles.length > 0) {
      setFilesExpanded((v) => !v)
      return
    }
  })

  const displayName = session.alias ?? session.name
  const branch = session.currentBranch ?? session.gitBranch ?? null
  const model = session.context.latestModel
  const contextTokens = session.context.latestContextTokens
  const status = primaryStatus(session.signals)
  const isLoading = preview === null
  const automaticContext = preview?.automaticContext ?? null

  // Interrupted when signals say so, or when the preview reveals a pending tool
  const interrupted =
    session.signals.interrupted === true ||
    session.signals.lastToolFailed === true ||
    preview?.pendingToolName != null

  const terminalWidth = stdout?.columns ?? 80
  const dividerWidth = Math.max(8, terminalWidth - projectPanelWidthForTerminal(terminalWidth) - 6)

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Box gap={1} marginBottom={0}>
        <Text color={isActive ? COLORS.ok : COLORS.border}>●</Text>
        <Text bold color={COLORS.text} wrap="truncate">
          {displayName}
        </Text>
      </Box>

      <Box gap={2} marginBottom={1} paddingLeft={2}>
        {branch ? <Text color={COLORS.muted}>{branch}</Text> : null}
        <Text color={COLORS.dim}>{relativeTime(session.updated)}</Text>
        <Text color={COLORS.dim}>
          {session.messageCount} {LABELS.messageCountSuffix}
        </Text>
        {model ? <Text color={COLORS.border}>{shortModelName(model)}</Text> : null}
        {contextTokens !== null ? (
          <Text color={COLORS.dim}>
            {formatTokenCount(contextTokens)} {LABELS.contextSuffix}
          </Text>
        ) : null}
        <Text color={COLORS.border}>{LABELS.resumeCardPreviewSuffix}</Text>
      </Box>

      {session.tags && session.tags.length > 0 ? (
        <Box gap={1} marginBottom={1} paddingLeft={2}>
          {session.tags.slice(0, 4).map((tag) => (
            <Text key={tag} color={COLORS.accent}>
              #{tag}
            </Text>
          ))}
          {session.tags.length > 4 ? (
            <Text color={COLORS.muted}>+{session.tags.length - 4}</Text>
          ) : null}
        </Box>
      ) : null}

      <Box marginBottom={1}>
        <Text color={COLORS.border} wrap="truncate">
          {'─'.repeat(dividerWidth)}
        </Text>
      </Box>

      {/* ── Live / status signals ────────────────────────────────────────── */}
      {isActive ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.ok}>{LABELS.activeSessionWarningTitle}</Text>
          {lockInfo ? (
            <Text color={COLORS.dim}>
              {'   '}
              {lockInfo.cwd ? shortenPath(lockInfo.cwd) + '  ·  ' : ''}
              {lockInfo.startedAt ? 'started ' + relativeTime(lockInfo.startedAt) + '  ·  ' : ''}
              {'PID ' + lockInfo.pid}
            </Text>
          ) : null}
          <Box flexDirection="column" marginTop={1} paddingLeft={2}>
            <Text color={COLORS.warn}>{LABELS.activeSessionWarningIntro}</Text>
            <Text color={COLORS.muted}>{LABELS.activeSessionWarningTranscript}</Text>
            <Text color={COLORS.muted}>{LABELS.activeSessionWarningVisibility}</Text>
            <Text color={COLORS.muted}>{LABELS.activeSessionWarningFiles}</Text>
          </Box>
        </Box>
      ) : status === 'expiring' ? (
        <Box marginBottom={1}>
          <Text color={COLORS.danger}>{LABELS.expiringWarning}</Text>
        </Box>
      ) : status === 'path-missing' ? (
        <Box marginBottom={1}>
          <Text color={COLORS.danger}>{LABELS.pathMissingWarning}</Text>
        </Box>
      ) : null}

      {/* ── Content sections ─────────────────────────────────────────────── */}
      <PreviewSection
        isLoading={isLoading}
        label="what you asked for"
        text={preview?.goal ?? null}
      />
      <PreviewSection
        isLoading={isLoading}
        label="where claude left off"
        text={preview?.lastResponse ?? null}
      />
      {!isLoading && automaticContext?.plan ? (
        <PreviewSection
          isLoading={false}
          label={automaticFactLabel(
            'native plan',
            automaticContext.plan.source,
            automaticContext.plan.updatedAt
          )}
          text={automaticContext.plan.text}
        />
      ) : null}
      {!isLoading && automaticContext && automaticContext.todos.items.length > 0 ? (
        <TodoPreviewSection todos={automaticContext.todos} />
      ) : null}

      {/* ── Stopped mid-task ─────────────────────────────────────────────── */}
      {!isLoading && interrupted ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.warn}>{LABELS.interruptedWarningTitle}</Text>
          <Text color={COLORS.muted}>{LABELS.interruptedWarningBody}</Text>
        </Box>
      ) : null}

      {/* ── Files in use ─────────────────────────────────────────────────── */}
      {!isLoading && preview && preview.touchedFiles.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.dim}>
            {LABELS.filesInUseLabel}
            <Text color={COLORS.textSub}>{preview.touchedFiles.length}</Text>
          </Text>
          {filesExpanded
            ? preview.touchedFiles.map((f) => (
                <Text key={f} color={COLORS.accent} wrap="truncate">
                  {'  ' + makeRelative(f, session.projectPath)}
                </Text>
              ))
            : null}
        </Box>
      ) : null}

      {/* ── Spacer + footer hint ─────────────────────────────────────────── */}
      <Box flexGrow={1} />
      <Box gap={3}>
        <Text>
          <Text color={COLORS.ok}>▶ {LABELS.keyEnter}</Text>
          <Text color={COLORS.muted}>
            {' '}
            {LABELS.wordResume} {LABELS.wordSession}
          </Text>
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>{LABELS.keyEsc}</Text>
          {' ' + LABELS.wordBack}
        </Text>
        {!isLoading && preview && preview.touchedFiles.length > 0 ? (
          <Text color={COLORS.muted}>
            <Text color={COLORS.text}>{LABELS.keyFiles}</Text>
            {' ' + LABELS.wordFiles}
          </Text>
        ) : null}
      </Box>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Sub-component
// ---------------------------------------------------------------------------

interface PreviewSectionProps {
  isLoading: boolean
  label: string
  text: string | null
}

function PreviewSection({ isLoading, label, text }: PreviewSectionProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={COLORS.dim}>{label}</Text>
      {isLoading ? (
        <Text color={COLORS.border}>···</Text>
      ) : text ? (
        <Text color={COLORS.textSub}>{text}</Text>
      ) : (
        <Text color={COLORS.border}>—</Text>
      )}
    </Box>
  )
}

interface TodoPreviewSectionProps {
  todos: NativeTodoState
}

function TodoPreviewSection({ todos }: TodoPreviewSectionProps) {
  const visibleTodos = selectVisibleTodos(todos.items)

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={COLORS.dim}>{formatTodoHeading(todos)}</Text>
      {visibleTodos.map((todo, index) => (
        <Text
          key={`${todo.status}:${todo.content}:${index}`}
          color={todoColor(todo)}
          wrap="truncate"
        >
          {'  ' + todoMarker(todo) + ' ' + todo.content}
        </Text>
      ))}
      {todos.items.length > visibleTodos.length ? (
        <Text color={COLORS.border}>{`  +${todos.items.length - visibleTodos.length} more`}</Text>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const MAX_VISIBLE_TODOS = 5

function formatTodoHeading(todos: NativeTodoState): string {
  const openCount = todos.counts.pending + todos.counts.in_progress + todos.counts.unknown
  const completedCount = todos.counts.completed
  const parts = [
    automaticFactLabel('native todos', todos.source, todos.updatedAt),
    `${openCount} open`,
  ]
  if (completedCount > 0) parts.push(`${completedCount} done`)
  return parts.join(' · ')
}

function automaticFactLabel(
  label: string,
  source: string | null,
  updatedAt: string | null
): string {
  const sourceLabel = source ? source.replaceAll('-', ' ') : 'source unavailable'
  const freshness = updatedAt ? relativeTime(updatedAt) : 'time unavailable'
  return `${label} · ${sourceLabel} · ${freshness}`
}

function selectVisibleTodos(items: NativeTodoItem[]): NativeTodoItem[] {
  const unfinished = items.filter((todo) => todo.status !== 'completed')
  return (unfinished.length > 0 ? unfinished : items).slice(0, MAX_VISIBLE_TODOS)
}

function todoMarker(todo: NativeTodoItem): string {
  if (todo.status === 'completed') return '[x]'
  if (todo.status === 'in_progress') return '[~]'
  if (todo.status === 'pending') return '[ ]'
  return '[?]'
}

function todoColor(todo: NativeTodoItem): string {
  if (todo.status === 'completed') return COLORS.ok
  if (todo.status === 'in_progress') return COLORS.warn
  if (todo.status === 'pending') return COLORS.textSub
  return COLORS.border
}

function shortModelName(model: string): string {
  const m = model.match(/claude-(\w+)-(\d+(?:\.\d+)?)/)
  return m ? `${m[1]} ${m[2]}` : model
}

function formatTokenCount(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}m`
}

function makeRelative(filePath: string, projectPath: string): string {
  const f = filePath.replace(/\\/g, '/')
  const p = projectPath.replace(/\\/g, '/').replace(/\/$/, '')
  return f.startsWith(p + '/') ? f.slice(p.length + 1) : filePath
}

function shortenPath(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? ''
  const withTilde = home ? normalized.replace(home.replace(/\\/g, '/'), '~') : normalized
  const segments = withTilde.split('/')
  return segments.length > 3 ? '…/' + segments.slice(-2).join('/') : withTilde
}

import { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'

import { COLORS } from '../../config/theme.js'
import { getSessionLockInfo } from '../../core/session/active-sessions.js'
import type { SessionLockInfo } from '../../core/session/active-sessions.js'
import type { Session } from '../../core/session/session-model.js'
import { primaryStatus } from '../../core/session/session-signals.js'
import { loadSessionPreview, sessionTranscriptPath } from '../../core/session/session-preview.js'
import type { SessionPreview } from '../../core/session/session-preview.js'
import { relativeTime } from '../../utils/time.js'

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

  // Interrupted when signals say so, or when the preview reveals a pending tool
  const interrupted =
    session.signals.interrupted === true ||
    session.signals.lastToolFailed === true ||
    preview?.pendingToolName != null

  const dividerWidth = Math.max(8, (stdout?.columns ?? 80) - 34 /* project panel */ - 6)

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
        <Text color={COLORS.dim}>{session.messageCount} msgs</Text>
        {model ? <Text color={COLORS.border}>{shortModelName(model)}</Text> : null}
        {contextTokens !== null ? (
          <Text color={COLORS.dim}>{formatTokenCount(contextTokens)} ctx</Text>
        ) : null}
        <Text color={COLORS.border}>· preview</Text>
      </Box>

      <Box marginBottom={1}>
        <Text color={COLORS.border} wrap="truncate">
          {'─'.repeat(dividerWidth)}
        </Text>
      </Box>

      {/* ── Live / status signals ────────────────────────────────────────── */}
      {isActive ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.ok}>⚡ another session is already live right now</Text>
          {lockInfo ? (
            <Text color={COLORS.dim}>
              {'   '}
              {lockInfo.cwd ? shortenPath(lockInfo.cwd) + '  ·  ' : ''}
              {lockInfo.startedAt ? 'started ' + relativeTime(lockInfo.startedAt) + '  ·  ' : ''}
              {'PID ' + lockInfo.pid}
            </Text>
          ) : null}
          <Box flexDirection="column" marginTop={1} paddingLeft={2}>
            <Text color={COLORS.warn}>resuming here will start a second instance. this means:</Text>
            <Text color={COLORS.muted}>
              {'  · both processes write to the same transcript — it will get scrambled'}
            </Text>
            <Text color={COLORS.muted}>
              {'  · neither Claude will see what the other is doing'}
            </Text>
            <Text color={COLORS.muted}>
              {'  · simultaneous file edits can overwrite each other'}
            </Text>
          </Box>
        </Box>
      ) : status === 'expiring' ? (
        <Box marginBottom={1}>
          <Text color={COLORS.danger}>⚠ expiring soon — transcript will be removed shortly</Text>
        </Box>
      ) : status === 'path-missing' ? (
        <Box marginBottom={1}>
          <Text color={COLORS.danger}>⚠ project path not found on this machine</Text>
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

      {/* ── Stopped mid-task ─────────────────────────────────────────────── */}
      {!isLoading && interrupted ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.warn}>⚠ Claude stopped mid-task</Text>
          <Text color={COLORS.muted}>
            {' '}
            resuming picks up where it left off — the last step may run again
          </Text>
        </Box>
      ) : null}

      {/* ── Files in use ─────────────────────────────────────────────────── */}
      {!isLoading && preview && preview.touchedFiles.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={COLORS.dim}>
            {'files in use · '}
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
          <Text color={COLORS.ok}>▶ enter</Text>
          <Text color={COLORS.muted}> resume session</Text>
        </Text>
        <Text color={COLORS.muted}>
          <Text color={COLORS.text}>esc</Text>
          {' back'}
        </Text>
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

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

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

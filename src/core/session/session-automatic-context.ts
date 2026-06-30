import { extractWriteToolPaths, isWriteLikeTool } from './session-touched-files.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutomaticFactSource =
  | 'attachment'
  | 'assistant-tool'
  | 'summary-event'
  | 'tool-result'
  | 'transcript-event'

export type NativeTodoStatus = 'completed' | 'in_progress' | 'pending' | 'unknown'

export interface AutomaticSessionContext {
  agentActivity: AgentActivitySummary
  execution: ExecutionContextFacts
  plan: NativePlanState | null
  readFiles: string[]
  researchActions: ResearchAction[]
  summaries: TranscriptSummaryFacts
  todos: NativeTodoState
  toolHealth: ToolHealthSummary
  touchedFiles: string[]
}

export interface AgentActivitySummary {
  agentIds: string[]
  agentNames: string[]
  sidechainEventCount: number
  taskToolUseCount: number
}

export interface ExecutionContextFacts {
  cwd: string | null
  entrypoint: string | null
  gitBranch: string | null
  permissionMode: string | null
  slug: string | null
  version: string | null
}

export interface NativePlanState {
  source: AutomaticFactSource
  text: string
  updatedAt: string | null
  wasEdited: boolean | null
}

export interface NativeTodoItem {
  activeForm: string | null
  content: string
  status: NativeTodoStatus
}

export interface NativeTodoState {
  counts: Record<NativeTodoStatus, number>
  items: NativeTodoItem[]
  source: AutomaticFactSource | null
  updatedAt: string | null
}

export interface ResearchAction {
  kind: 'glob' | 'grep' | 'web-fetch' | 'web-search'
  query: string | null
}

export interface ToolHealthSummary {
  failed: ToolObservation[]
  interrupted: ToolObservation[]
  pending: ToolObservation[]
  slow: ToolObservation[]
  truncated: ToolObservation[]
}

export interface ToolObservation {
  durationMs: number | null
  id: string | null
  name: string
  timestamp: string | null
}

export interface TranscriptSummaryFacts {
  compactBoundaryCount: number
  latestPrompt: string | null
  latestSummary: string | null
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const MAX_FACT_TEXT_CHARS = 1_200
const MAX_FILES = 16
const MAX_RESEARCH_ACTIONS = 12
const MAX_TOOL_OBSERVATIONS = 12
const SLOW_TOOL_THRESHOLD_MS = 30_000

/**
 * Extracts structured, read-only facts that Claude Code already recorded.
 *
 * This module deliberately does not infer user intent from arbitrary prose when
 * a structured artifact exists. Consumers should present unavailable fields as
 * unknown rather than manufacturing context.
 */
export function extractAutomaticSessionContext(lines: string[]): AutomaticSessionContext {
  const pendingTools = new Map<string, ToolObservation>()
  const touchedFiles: string[] = []
  const readFiles: string[] = []
  const researchActions: ResearchAction[] = []
  const failedTools: ToolObservation[] = []
  const interruptedTools: ToolObservation[] = []
  const slowTools: ToolObservation[] = []
  const truncatedTools: ToolObservation[] = []
  const agentIds = new Set<string>()
  const agentNames = new Set<string>()
  const execution = emptyExecutionContext()
  const summaries: TranscriptSummaryFacts = {
    compactBoundaryCount: 0,
    latestPrompt: null,
    latestSummary: null,
  }

  let sidechainEventCount = 0
  let taskToolUseCount = 0
  let plan: NativePlanState | null = null
  let todos = emptyTodoState()

  for (const line of lines) {
    const event = parseEvent(line)
    if (!event) continue

    const timestamp = stringValue(event['timestamp'])
    updateExecutionContext(execution, event)
    collectTopLevelFacts(event, summaries, agentIds, agentNames)
    if (event['isSidechain'] === true) sidechainEventCount++

    const attachment = objectValue(event['attachment'])
    if (attachment) {
      const attachmentPlan = planFromAttachment(attachment, timestamp)
      if (attachmentPlan) plan = attachmentPlan
    }

    const message = objectValue(event['message'])
    const content = message?.['content']
    if (event['type'] === 'assistant') {
      taskToolUseCount += collectAssistantToolUses({
        agentIds,
        agentNames,
        content,
        pendingTools,
        planSink: (nextPlan) => {
          plan = nextPlan
        },
        readFiles,
        researchActions,
        timestamp,
        todosSink: (nextTodos) => {
          todos = nextTodos
        },
        touchedFiles,
      })
    } else if (event['type'] === 'user') {
      collectToolResults({
        event,
        failedTools,
        interruptedTools,
        pendingTools,
        planSink: (nextPlan) => {
          plan = nextPlan
        },
        slowTools,
        timestamp,
        todosSink: (nextTodos) => {
          todos = nextTodos
        },
        truncatedTools,
      })
    }
  }

  return {
    agentActivity: {
      agentIds: [...agentIds],
      agentNames: [...agentNames],
      sidechainEventCount,
      taskToolUseCount,
    },
    execution,
    plan,
    readFiles: deduplicateTail(readFiles, MAX_FILES),
    researchActions: deduplicateResearchActions(researchActions, MAX_RESEARCH_ACTIONS),
    summaries,
    todos,
    toolHealth: {
      failed: limitTail(failedTools, MAX_TOOL_OBSERVATIONS),
      interrupted: limitTail(interruptedTools, MAX_TOOL_OBSERVATIONS),
      pending: [...pendingTools.values()].slice(-MAX_TOOL_OBSERVATIONS),
      slow: limitTail(slowTools, MAX_TOOL_OBSERVATIONS),
      truncated: limitTail(truncatedTools, MAX_TOOL_OBSERVATIONS),
    },
    touchedFiles: deduplicateTail(touchedFiles, MAX_FILES),
  }
}

// ---------------------------------------------------------------------------
// Event collectors
// ---------------------------------------------------------------------------

function collectTopLevelFacts(
  event: Record<string, unknown>,
  summaries: TranscriptSummaryFacts,
  agentIds: Set<string>,
  agentNames: Set<string>
): void {
  if (event['type'] === 'summary' && typeof event['summary'] === 'string') {
    summaries.latestSummary = compactText(event['summary'])
  }
  if (event['type'] === 'system' && event['subtype'] === 'compact_boundary') {
    summaries.compactBoundaryCount++
  }
  if (event['type'] === 'last-prompt' && typeof event['lastPrompt'] === 'string') {
    summaries.latestPrompt = compactText(event['lastPrompt'])
  }

  addIfString(agentIds, event['agentId'])
  addIfString(agentNames, event['agentName'])
  addIfString(agentNames, event['attributionAgent'])
}

interface AssistantToolUseOptions {
  agentIds: Set<string>
  agentNames: Set<string>
  content: unknown
  pendingTools: Map<string, ToolObservation>
  planSink: (plan: NativePlanState) => void
  readFiles: string[]
  researchActions: ResearchAction[]
  timestamp: string | null
  todosSink: (todos: NativeTodoState) => void
  touchedFiles: string[]
}

function collectAssistantToolUses(options: AssistantToolUseOptions): number {
  if (!Array.isArray(options.content)) return 0
  let taskToolUseCount = 0

  for (const block of options.content as Record<string, unknown>[]) {
    if (block['type'] !== 'tool_use') continue

    const toolName = stringValue(block['name'])
    if (!toolName) continue

    const toolId = stringValue(block['id'])
    const input = objectValue(block['input'])
    const observation = createToolObservation(toolName, toolId, options.timestamp)
    if (toolId) options.pendingTools.set(toolId, observation)

    const normalizedToolName = toolName.toLowerCase()
    if (isTaskTool(normalizedToolName)) taskToolUseCount++

    if (normalizedToolName === 'todowrite' && Array.isArray(input?.['todos'])) {
      options.todosSink(todoStateFromRaw(input['todos'], 'assistant-tool', options.timestamp))
    }

    const toolPlan = planFromToolUse(normalizedToolName, input, options.timestamp)
    if (toolPlan) options.planSink(toolPlan)

    collectToolFileFacts(normalizedToolName, input, options.touchedFiles, options.readFiles)
    collectResearchAction(normalizedToolName, input, options.researchActions)
    collectAgentFacts(normalizedToolName, input, options.agentIds, options.agentNames)
  }

  return taskToolUseCount
}

interface ToolResultOptions {
  event: Record<string, unknown>
  failedTools: ToolObservation[]
  interruptedTools: ToolObservation[]
  pendingTools: Map<string, ToolObservation>
  planSink: (plan: NativePlanState) => void
  slowTools: ToolObservation[]
  timestamp: string | null
  todosSink: (todos: NativeTodoState) => void
  truncatedTools: ToolObservation[]
}

function collectToolResults(options: ToolResultOptions): void {
  const content = messageContent(options.event)
  let firstContentToolUseId: string | null = null
  let firstContentObservation: ToolObservation | null = null
  if (Array.isArray(content)) {
    for (const block of content as Record<string, unknown>[]) {
      if (block['type'] !== 'tool_result') continue
      const toolUseId = stringValue(block['tool_use_id'])
      firstContentToolUseId ??= toolUseId
      const observation = observationForToolResult(
        toolUseId,
        options.pendingTools,
        options.timestamp
      )
      firstContentObservation ??= observation
      if (block['is_error'] === true) options.failedTools.push(observation)
      if (toolUseId) options.pendingTools.delete(toolUseId)
    }
  }

  const result = objectValue(options.event['toolUseResult'])
  if (!result) return

  const toolUseId =
    stringValue(options.event['toolUseID']) ??
    stringValue(options.event['toolUseId']) ??
    firstContentToolUseId
  const observation =
    firstContentObservation ??
    observationForToolResult(toolUseId, options.pendingTools, options.timestamp)
  observation.durationMs = numberValue(result['durationMs'])

  if (result['status'] === 'failed' || result['is_error'] === true) {
    options.failedTools.push(observation)
  }
  if (result['interrupted'] === true) options.interruptedTools.push(observation)
  if (result['truncated'] === true) options.truncatedTools.push(observation)
  if (
    typeof observation.durationMs === 'number' &&
    observation.durationMs >= SLOW_TOOL_THRESHOLD_MS
  ) {
    options.slowTools.push(observation)
  }

  if (Array.isArray(result['newTodos'])) {
    options.todosSink(todoStateFromRaw(result['newTodos'], 'tool-result', options.timestamp))
  }
  if (typeof result['plan'] === 'string') {
    options.planSink({
      source: 'tool-result',
      text: compactMarkdownText(result['plan']),
      updatedAt: options.timestamp,
      wasEdited: booleanOrNull(result['planWasEdited']),
    })
  }

  if (toolUseId) options.pendingTools.delete(toolUseId)
}

// ---------------------------------------------------------------------------
// Plan and TODO extraction
// ---------------------------------------------------------------------------

function planFromAttachment(
  attachment: Record<string, unknown>,
  timestamp: string | null
): NativePlanState | null {
  const type = stringValue(attachment['type'])
  if (!type || !type.includes('plan')) return null

  const text =
    stringValue(attachment['plan']) ??
    stringValue(attachment['content']) ??
    stringValue(attachment['text']) ??
    stringValue(attachment['summary'])

  if (!text) return null
  return {
    source: 'attachment',
    text: compactMarkdownText(text),
    updatedAt: timestamp,
    wasEdited: booleanOrNull(attachment['planWasEdited']),
  }
}

function planFromToolUse(
  normalizedToolName: string,
  input: Record<string, unknown> | null,
  timestamp: string | null
): NativePlanState | null {
  if (normalizedToolName !== 'exitplanmode' || !input) return null
  const text =
    stringValue(input['plan']) ?? stringValue(input['content']) ?? stringValue(input['text'])
  if (!text) return null

  return {
    source: 'assistant-tool',
    text: compactMarkdownText(text),
    updatedAt: timestamp,
    wasEdited: null,
  }
}

function todoStateFromRaw(
  rawTodos: unknown,
  source: AutomaticFactSource,
  timestamp: string | null
): NativeTodoState {
  const items = Array.isArray(rawTodos)
    ? (rawTodos as Record<string, unknown>[])
        .map((todo) => normalizeTodoItem(todo))
        .filter((todo): todo is NativeTodoItem => todo !== null)
    : []

  return {
    counts: countTodos(items),
    items,
    source,
    updatedAt: timestamp,
  }
}

function normalizeTodoItem(todo: Record<string, unknown>): NativeTodoItem | null {
  const content = stringValue(todo['content'])
  if (!content) return null
  return {
    activeForm: stringValue(todo['activeForm']),
    content: compactText(content),
    status: normalizeTodoStatus(todo['status']),
  }
}

function normalizeTodoStatus(status: unknown): NativeTodoStatus {
  if (status === 'completed' || status === 'in_progress' || status === 'pending') return status
  return 'unknown'
}

function countTodos(items: NativeTodoItem[]): Record<NativeTodoStatus, number> {
  const counts: Record<NativeTodoStatus, number> = {
    completed: 0,
    in_progress: 0,
    pending: 0,
    unknown: 0,
  }
  for (const item of items) counts[item.status]++
  return counts
}

function emptyTodoState(): NativeTodoState {
  return {
    counts: { completed: 0, in_progress: 0, pending: 0, unknown: 0 },
    items: [],
    source: null,
    updatedAt: null,
  }
}

// ---------------------------------------------------------------------------
// Tool facts
// ---------------------------------------------------------------------------

function collectToolFileFacts(
  normalizedToolName: string,
  input: Record<string, unknown> | null,
  touchedFiles: string[],
  readFiles: string[]
): void {
  if (!input) return

  if (isWriteLikeTool(normalizedToolName)) {
    touchedFiles.push(...extractWriteToolPaths(input))
  } else if (normalizedToolName === 'read') {
    const path = stringValue(input['file_path']) ?? stringValue(input['path'])
    if (path) readFiles.push(path)
  }
}

function collectResearchAction(
  normalizedToolName: string,
  input: Record<string, unknown> | null,
  researchActions: ResearchAction[]
): void {
  if (!input) return

  if (normalizedToolName === 'grep') {
    researchActions.push({ kind: 'grep', query: stringValue(input['pattern']) })
  } else if (normalizedToolName === 'glob') {
    researchActions.push({ kind: 'glob', query: stringValue(input['pattern']) })
  } else if (normalizedToolName === 'websearch') {
    researchActions.push({ kind: 'web-search', query: stringValue(input['query']) })
  } else if (normalizedToolName === 'webfetch') {
    researchActions.push({ kind: 'web-fetch', query: stringValue(input['url']) })
  }
}

function collectAgentFacts(
  normalizedToolName: string,
  input: Record<string, unknown> | null,
  agentIds: Set<string>,
  agentNames: Set<string>
): void {
  if (!input) return
  if (isTaskTool(normalizedToolName) || normalizedToolName === 'agent') {
    addIfString(agentIds, input['agentId'])
    addIfString(agentNames, input['agentType'])
    addIfString(agentNames, input['subagent_type'])
    addIfString(agentNames, input['description'])
  }
}

function isTaskTool(normalizedToolName: string): boolean {
  return normalizedToolName === 'agent' || normalizedToolName.startsWith('task')
}

function createToolObservation(
  name: string,
  id: string | null,
  timestamp: string | null
): ToolObservation {
  return { durationMs: null, id, name, timestamp }
}

function observationForToolResult(
  toolUseId: string | null,
  pendingTools: Map<string, ToolObservation>,
  timestamp: string | null
): ToolObservation {
  if (toolUseId) {
    const pending = pendingTools.get(toolUseId)
    if (pending) return { ...pending }
  }
  return createToolObservation('unknown tool', toolUseId, timestamp)
}

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

function emptyExecutionContext(): ExecutionContextFacts {
  return {
    cwd: null,
    entrypoint: null,
    gitBranch: null,
    permissionMode: null,
    slug: null,
    version: null,
  }
}

function updateExecutionContext(
  execution: ExecutionContextFacts,
  event: Record<string, unknown>
): void {
  execution.cwd = stringValue(event['cwd']) ?? execution.cwd
  execution.entrypoint = stringValue(event['entrypoint']) ?? execution.entrypoint
  execution.gitBranch = stringValue(event['gitBranch']) ?? execution.gitBranch
  execution.permissionMode = stringValue(event['permissionMode']) ?? execution.permissionMode
  execution.slug = stringValue(event['slug']) ?? execution.slug
  execution.version = stringValue(event['version']) ?? execution.version
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseEvent(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

function messageContent(event: Record<string, unknown>): unknown {
  return objectValue(event['message'])?.['content']
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function addIfString(values: Set<string>, value: unknown): void {
  const text = stringValue(value)
  if (text) values.add(text)
}

function compactText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= MAX_FACT_TEXT_CHARS) return normalized
  return normalized.slice(0, MAX_FACT_TEXT_CHARS - 1).trimEnd() + '…'
}

function compactMarkdownText(text: string): string {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (normalized.length <= MAX_FACT_TEXT_CHARS) return normalized
  return normalized.slice(0, MAX_FACT_TEXT_CHARS - 1).trimEnd() + '…'
}

function deduplicateTail(items: string[], max: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (let i = items.length - 1; i >= 0 && result.length < max; i--) {
    const item = items[i]
    if (item && !seen.has(item)) {
      seen.add(item)
      result.push(item)
    }
  }
  return result
}

function deduplicateResearchActions(actions: ResearchAction[], max: number): ResearchAction[] {
  const seen = new Set<string>()
  const result: ResearchAction[] = []
  for (let i = actions.length - 1; i >= 0 && result.length < max; i--) {
    const action = actions[i]
    const key = `${action.kind}:${action.query ?? ''}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(action)
    }
  }
  return result
}

function limitTail<T>(items: T[], max: number): T[] {
  return items.slice(Math.max(0, items.length - max))
}

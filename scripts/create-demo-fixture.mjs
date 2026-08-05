import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const FIXTURE_DIRECTORY_NAME = 'reup-product-demo'

const SESSION_IDS = {
  apiDocs: '10000000-0000-4000-8000-000000000004',
  attached: '10000000-0000-4000-8000-000000000003',
  checkout: '20000000-0000-4000-8000-000000000001',
  needsInput: '10000000-0000-4000-8000-000000000001',
  onboarding: '30000000-0000-4000-8000-000000000001',
  performance: '20000000-0000-4000-8000-000000000002',
  working: '10000000-0000-4000-8000-000000000002',
}

const PROJECTS = [
  {
    directory: 'atlas-platform',
    sessions: [
      {
        alias: 'Approve production migration',
        assistant:
          'The migration plan is ready. I am waiting for permission to run the final check.',
        branch: 'feat/zero-downtime-migration',
        contextTokens: 82_430,
        id: SESSION_IDS.needsInput,
        minutesAgo: 4,
        request: 'Prepare a zero-downtime migration and verify the production checklist.',
        tags: ['release', 'database'],
        tool: { input: { command: 'npm run migration:verify' }, name: 'Bash' },
      },
      {
        alias: 'Harden checkout integration tests',
        assistant: 'The two flaky cases are isolated. I am running the focused suite now.',
        branch: 'fix/checkout-flakes',
        contextTokens: 61_280,
        id: SESSION_IDS.working,
        minutesAgo: 1,
        request: 'Find and fix the intermittent checkout test failures.',
        tags: ['tests'],
        tool: { input: { command: 'npm test -- checkout' }, name: 'Bash' },
      },
      {
        alias: 'Document the API rollout plan',
        assistant: 'The rollout phases and rollback criteria are drafted for review.',
        branch: 'docs/api-rollout',
        contextTokens: 28_940,
        id: SESSION_IDS.attached,
        minutesAgo: 18,
        request: 'Write the API rollout plan for the platform team.',
        tags: ['docs'],
      },
      {
        alias: 'Refactor request validation',
        assistant: 'Validation now shares one typed schema and all focused tests pass.',
        branch: 'refactor/request-validation',
        contextTokens: 47_110,
        id: SESSION_IDS.apiDocs,
        minutesAgo: 95,
        request: 'Consolidate request validation without changing the public API.',
        tags: ['backend'],
      },
    ],
  },
  {
    directory: 'mobile-checkout',
    sessions: [
      {
        alias: 'Finish wallet checkout flow',
        assistant: 'The happy path is complete; the offline retry still needs implementation.',
        branch: 'feat/wallet-checkout',
        contextTokens: 54_800,
        id: SESSION_IDS.checkout,
        minutesAgo: 42,
        request: 'Implement wallet checkout with a resilient offline retry.',
        tags: ['mobile'],
      },
      {
        alias: 'Profile cart rendering',
        assistant: 'The main cost is repeated selector work; I recorded three safe optimizations.',
        branch: 'perf/cart-rendering',
        contextTokens: 36_420,
        id: SESSION_IDS.performance,
        minutesAgo: 180,
        request: 'Profile the cart screen and propose measurable rendering improvements.',
        tags: ['performance'],
      },
    ],
  },
  {
    directory: 'developer-portal',
    sessions: [
      {
        alias: 'Polish first-run onboarding',
        assistant: 'The revised walkthrough is implemented and accessibility checks pass.',
        branch: 'feat/onboarding-copy',
        contextTokens: 24_760,
        id: SESSION_IDS.onboarding,
        minutesAgo: 360,
        request: 'Make the first-run onboarding shorter and easier to scan.',
        tags: ['ux'],
      },
    ],
  },
]

/**
 * Creates an isolated, synthetic Claude data directory for product captures.
 * No fixture value is read from the developer's real Claude configuration.
 */
export async function createDemoFixture({ livePid, rootDirectory, now = Date.now() }) {
  const root = validateFixtureRoot(rootDirectory)
  if (!Number.isInteger(livePid) || livePid <= 0) {
    throw new Error('--live-pid must identify a positive integer process ID')
  }

  await rm(root, { force: true, recursive: true })
  const claudeDirectory = join(root, 'claude')
  const projectsDirectory = join(claudeDirectory, 'projects')
  const workspaceRoot = join(root, 'workspaces')
  await Promise.all([
    mkdir(projectsDirectory, { recursive: true }),
    mkdir(join(claudeDirectory, 'sessions'), { recursive: true }),
    mkdir(join(claudeDirectory, 'reup', 'attention'), { recursive: true }),
  ])

  for (const project of PROJECTS) {
    const projectPath = join(workspaceRoot, project.directory)
    const projectDirectory = join(projectsDirectory, encodeProjectPath(projectPath))
    await Promise.all([
      mkdir(projectPath, { recursive: true }),
      mkdir(projectDirectory, { recursive: true }),
    ])

    const sidecarSessions = {}
    for (const session of project.sessions) {
      const transcript = buildTranscript(session, projectPath, now)
      await writeFile(join(projectDirectory, `${session.id}.jsonl`), transcript, 'utf8')
      sidecarSessions[session.id] = { alias: session.alias, tags: session.tags }
    }
    await writeJson(join(projectDirectory, 'reup.json'), {
      projectTags: project.directory === 'atlas-platform' ? ['launch'] : [],
      sessions: sidecarSessions,
    })
  }

  await writeLiveLocks(claudeDirectory, workspaceRoot, livePid, now)
  await writeAttentionMarker(claudeDirectory, now)

  return {
    claudeDirectory,
    deepLink: SESSION_IDS.needsInput,
    root,
    workspaceRoot,
  }
}

function buildTranscript(session, projectPath, now) {
  const assistantAt = new Date(now - session.minutesAgo * 60_000).toISOString()
  const userAt = new Date(Date.parse(assistantAt) - 4 * 60_000).toISOString()
  const content = [{ text: session.assistant, type: 'text' }]
  if (session.tool) {
    content.push({
      id: `tool-${session.id.slice(0, 8)}`,
      input: session.tool.input,
      name: session.tool.name,
      type: 'tool_use',
    })
  }

  return [
    {
      cwd: projectPath,
      gitBranch: session.branch,
      message: { content: session.request },
      timestamp: userAt,
      type: 'user',
    },
    {
      cwd: projectPath,
      gitBranch: session.branch,
      message: {
        content,
        model: 'claude-sonnet-4-6',
        usage: {
          cache_creation_input_tokens: 1_200,
          cache_read_input_tokens: session.contextTokens - 1_500,
          input_tokens: 300,
          output_tokens: 780,
        },
      },
      timestamp: assistantAt,
      type: 'assistant',
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n')
}

async function writeLiveLocks(claudeDirectory, workspaceRoot, livePid, now) {
  const locks = [
    {
      cwd: join(workspaceRoot, 'atlas-platform'),
      pid: livePid,
      sessionId: SESSION_IDS.needsInput,
      startedAt: now - 45 * 60_000,
      status: 'idle',
      statusUpdatedAt: now - 30_000,
    },
    {
      cwd: join(workspaceRoot, 'atlas-platform'),
      pid: livePid,
      sessionId: SESSION_IDS.working,
      startedAt: now - 32 * 60_000,
      status: 'busy',
      statusUpdatedAt: now - 45_000,
    },
    {
      cwd: join(workspaceRoot, 'atlas-platform'),
      pid: livePid,
      sessionId: SESSION_IDS.attached,
      startedAt: now - 70 * 60_000,
    },
  ]

  await Promise.all(
    locks.map((lock, index) =>
      writeJson(join(claudeDirectory, 'sessions', `demo-${index + 1}.json`), lock)
    )
  )
}

async function writeAttentionMarker(claudeDirectory, now) {
  const sessionId = SESSION_IDS.needsInput
  const stableKey = createHash('sha256').update(sessionId).digest('hex')
  await writeJson(join(claudeDirectory, 'reup', 'attention', `${stableKey}.json`), {
    message: 'Permission needed to run the final migration check',
    occurredAt: new Date(now - 15_000).toISOString(),
    schemaVersion: 1,
    sessionId,
  })
}

function encodeProjectPath(projectPath) {
  const windowsPath = projectPath.match(/^([a-zA-Z]):[/\\](.*)$/)
  if (windowsPath) {
    return `${windowsPath[1].toUpperCase()}--${windowsPath[2].replace(/[/\\]/g, '-')}`
  }
  return projectPath.replace(/^\//, '').replace(/\//g, '-')
}

function validateFixtureRoot(rootDirectory) {
  const root = resolve(rootDirectory ?? join(tmpdir(), FIXTURE_DIRECTORY_NAME))
  if (basename(root) !== FIXTURE_DIRECTORY_NAME || dirname(root) === root) {
    throw new Error(`fixture root must end with ${FIXTURE_DIRECTORY_NAME}`)
  }
  return root
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--root') options.rootDirectory = argv[++index]
    else if (argument === '--live-pid') options.livePid = Number(argv[++index])
    else throw new Error(`unknown argument: ${argument}`)
  }
  return options
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  try {
    const fixture = await createDemoFixture(readArguments(process.argv.slice(2)))
    console.log(JSON.stringify(fixture))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

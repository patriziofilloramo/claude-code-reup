let projects = []
let activeSessionIds = new Set()
let liveUsage = null
let selectedProject = null
let selectedSession = null
let selectedFilter = 'all'
let selectedProjectSort = 'recent'
let selectedSort = 'recent'
let searchQuery = ''
let renamingSessionId = null
let claudeInstructionsProjectId = null
let claudeInstructionsSaveTimer = null
let liveUpdatesSource = null
let usageRefreshInProgress = false
let deepLinkProcessed = false
let ctxProject = null
let ctxSession = null
let deepSearchActive = false
let deepSearchMatches = []
let deepSearchLoading = false
let deepSearchQueryTerm = ''
let sessionInspectorExpanded = false
let sessionPreviewCache = new Map()
let syncOverview = null
// Org data fetched from /api/org; null before first load.
let orgData = null
// Active focus filter — narrows both the project list and session list.
// Shape: null | { kind: 'inbox', bucket: string }
//             | { kind: 'stack', id: string, name: string }
//             | { kind: 'group', id: string, name: string }
//             | { kind: 'tag', tag: string }
let focusFilter = null
// Which rail section is showing an inline create input: 'stack' | 'group' | null
let railCreatingSection = null
// Which rail item is subject to a pending context menu action: null | { kind, id, name }
let ctxRailItem = null

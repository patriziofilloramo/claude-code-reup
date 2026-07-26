let projects = []
let activeSessionIds = new Set()
let liveUsage = null
let liveActivity = []
let selectedProject = null
let selectedSession = null
let selectedFilter = 'all'
let selectedProjectSort = 'recent'
let selectedSort = 'recent'
let searchQuery = ''
let renamingSessionId = null
let claudeInstructionsProjectId = null
let claudeInstructionsSaveTimer = null
let claudeInstructionsSaveQueue = Promise.resolve()
let claudeInstructionsDirty = false
let claudeInstructionsClosing = false
let liveUpdatesSource = null
let liveUpdatesRefreshTimer = null
let usageRefreshInProgress = false
let projectRefreshGeneration = 0
let deepLinkProcessed = false
let ctxProject = null
let ctxSession = null
let deepSearchActive = false
let deepSearchMatches = []
let deepSearchLoading = false
let deepSearchQueryTerm = ''
let sessionInspectorExpanded = false
let sessionPreviewCache = new Map()
// Org data fetched from /api/org; null before first load.
let orgData = null
// Active focus filter — narrows both the project list and session list.
// Shape: null | { kind: 'stack', id: string, name: string }
//             | { kind: 'group', id: string, name: string }
//             | { kind: 'tag', tag: string }
//             | { kind: 'review', id: string, name: string }
let focusFilter = null
// Which rail item is subject to a pending context menu action: null | { kind, id, name }
let ctxRailItem = null
// Desktop-alert bookkeeping: attention events already notified (sessionId:since)
// and each session's last seen activity state for turn-completion detection.
let notifiedAttentionKeys = new Set()
let previousActivityStates = new Map()

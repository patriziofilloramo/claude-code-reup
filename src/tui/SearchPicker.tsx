import { useState } from 'react'
import { render } from 'ink'

import type { ListedSession } from '../cli/list-command.js'
import type { ContentMatch } from '../core/session-search.js'
import type { Project } from '../core/session-model.js'
import { DeepSearchPicker } from './DeepSearchPicker.js'
import { SearchResultsPicker } from './SearchResultsPicker.js'

export type SearchResult =
  | { kind: 'resume'; session: ListedSession }
  | { kind: 'deep'; match: ContentMatch }

// ---------------------------------------------------------------------------
// Shell — manages normal ↔ deep switch within a single render tree
// ---------------------------------------------------------------------------

function SearchShell({
  initialQuery,
  sessions,
  projects,
  onResult,
}: {
  initialQuery?: string
  sessions: ListedSession[]
  projects: Project[]
  onResult: (result: SearchResult) => void
}) {
  const [mode, setMode] = useState<'normal' | 'deep'>('normal')
  const [deepQuery, setDeepQuery] = useState(initialQuery ?? '')

  const handleDeepSearch = (q: string) => {
    setDeepQuery(q)
    setMode('deep')
  }

  if (mode === 'deep') {
    return (
      <DeepSearchPicker
        query={deepQuery}
        projects={projects}
        onSelect={(match) => onResult({ kind: 'deep', match })}
        onBack={() => setMode('normal')}
      />
    )
  }

  return (
    <SearchResultsPicker
      query={initialQuery ?? ''}
      sessions={sessions}
      onSelect={(session) => onResult({ kind: 'resume', session })}
      onDeepSearch={handleDeepSearch}
    />
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runSearchPicker(
  sessions: ListedSession[],
  projects: Project[],
  initialQuery?: string,
): Promise<SearchResult | null> {
  return new Promise((resolve) => {
    let result: SearchResult | null = null
    const { waitUntilExit } = render(
      <SearchShell
        initialQuery={initialQuery}
        sessions={sessions}
        projects={projects}
        onResult={(r) => { result = r }}
      />
    )
    waitUntilExit()
      .then(() => resolve(result))
      .catch(() => resolve(null))
  })
}

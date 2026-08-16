/**
 * Minimal stand-in for the `vscode` module.
 *
 * Extension code could previously only be asserted against as source text,
 * because `vscode` exists only inside the extension host. That is why the
 * refresh controller — which decides when live state is re-read — had no
 * behavioural coverage at all. This stub records what the controller asks the
 * editor to watch, so a test can observe the wiring instead of reading it.
 *
 * It implements only what the controller touches. Anything else should fail
 * loudly rather than silently return undefined.
 */

export interface RecordedWatcher {
  changeListeners: Array<() => void>
  createListeners: Array<() => void>
  deleteListeners: Array<() => void>
  disposed: boolean
  pattern: { base: string; pattern: string }
}

const watchers: RecordedWatcher[] = []
let configuration = new Map<string, unknown>()

export function recordedWatchers(): RecordedWatcher[] {
  return watchers
}

export function resetVscodeStub(values: Record<string, unknown> = {}): void {
  watchers.length = 0
  configuration = new Map(Object.entries(values))
}

/** Watchers still live, i.e. not disposed — what the editor is actually watching. */
export function activeWatchers(): RecordedWatcher[] {
  return watchers.filter((watcher) => !watcher.disposed)
}

export class RelativePattern {
  constructor(
    readonly base: string,
    readonly pattern: string
  ) {}
}

export class Disposable {
  constructor(private readonly callback: () => void) {}
  dispose(): void {
    this.callback()
  }
}

function registerListener(target: Array<() => void>) {
  return (listener: () => void, _thisArg?: unknown, disposables?: Disposable[]) => {
    target.push(listener)
    const disposable = new Disposable(() => {
      const index = target.indexOf(listener)
      if (index >= 0) target.splice(index, 1)
    })
    disposables?.push(disposable)
    return disposable
  }
}

function noopEvent() {
  return new Disposable(() => {})
}

export const workspace = {
  createFileSystemWatcher(pattern: RelativePattern) {
    const watcher: RecordedWatcher = {
      changeListeners: [],
      createListeners: [],
      deleteListeners: [],
      disposed: false,
      pattern: { base: pattern.base, pattern: pattern.pattern },
    }
    watchers.push(watcher)
    return {
      dispose: () => {
        watcher.disposed = true
      },
      onDidChange: registerListener(watcher.changeListeners),
      onDidCreate: registerListener(watcher.createListeners),
      onDidDelete: registerListener(watcher.deleteListeners),
    }
  },
  getConfiguration(section: string) {
    return {
      get: <T>(key: string, fallback: T): T =>
        (configuration.get(`${section}.${key}`) as T) ?? fallback,
      inspect: <T>(key: string) => {
        const value = configuration.get(`${section}.${key}`)
        return value === undefined ? undefined : { globalValue: value as T }
      },
    }
  },
  onDidChangeConfiguration: () => noopEvent(),
  onDidChangeWorkspaceFolders: () => noopEvent(),
  workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
}

export const window = {
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: () => noopEvent(),
}

export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 }

import * as vscode from 'vscode'

import type { SessionScope } from './cockpit-model.js'

const CONFIG_SECTION = 'reup'
const LEGACY_CONFIG_SECTION = `${'swo'}${'op'}`
const SESSION_SCOPE_KEY = 'sessionScope'

interface ConfigurationInspection<T> {
  globalValue?: T
  workspaceFolderValue?: T
  workspaceValue?: T
}

export function getReupConfigurationValue<T>(key: string, fallback: T): T {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION)
  if (hasConfiguredValue(configuration.inspect<T>(key))) {
    return configuration.get<T>(key, fallback)
  }
  return vscode.workspace.getConfiguration(LEGACY_CONFIG_SECTION).get<T>(key, fallback)
}

/**
 * Reads the requested session scope, validated at the settings boundary: a
 * hand-edited settings.json can hold any string, and an unrecognised one must
 * fall back to the workspace-first default rather than widening silently.
 */
export function getSessionScopeSetting(): SessionScope {
  const value = getReupConfigurationValue<string>(SESSION_SCOPE_KEY, 'workspace')
  return value === 'all' ? 'all' : 'workspace'
}

/**
 * Persists the session scope to the narrowest target the user has already
 * chosen, defaulting to Global. Writing a workspace value unasked would create
 * a `.vscode/settings.json` inside the repository the user just opened.
 */
export async function setSessionScopeSetting(scope: SessionScope): Promise<void> {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION)
  const inspection = configuration.inspect<string>(SESSION_SCOPE_KEY)
  const target =
    inspection?.workspaceFolderValue !== undefined
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : inspection?.workspaceValue !== undefined
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global
  await configuration.update(SESSION_SCOPE_KEY, scope, target)
}

export function affectsReupConfiguration(
  event: vscode.ConfigurationChangeEvent,
  key: string
): boolean {
  return (
    event.affectsConfiguration(`${CONFIG_SECTION}.${key}`) ||
    event.affectsConfiguration(`${LEGACY_CONFIG_SECTION}.${key}`)
  )
}

export async function getMigratedGlobalState<T>(
  context: vscode.ExtensionContext,
  key: string
): Promise<T | undefined> {
  const current = context.globalState.get<T>(key)
  if (current !== undefined) return current

  const legacyKey = key.replace(/^reup\./, `${LEGACY_CONFIG_SECTION}.`)
  if (legacyKey === key) return undefined

  const legacyValue = context.globalState.get<T>(legacyKey)
  if (legacyValue !== undefined) await context.globalState.update(key, legacyValue)
  return legacyValue
}

function hasConfiguredValue<T>(inspection: ConfigurationInspection<T> | undefined) {
  return (
    inspection?.globalValue !== undefined ||
    inspection?.workspaceValue !== undefined ||
    inspection?.workspaceFolderValue !== undefined
  )
}

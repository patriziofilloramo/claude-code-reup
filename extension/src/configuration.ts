import * as vscode from 'vscode'

const CONFIG_SECTION = 'reup'
const LEGACY_CONFIG_SECTION = `${'swo'}${'op'}`

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

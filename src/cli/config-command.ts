import {
  PREF_SPECS,
  readUserPrefs,
  resetUserPrefs,
  setUserPref,
} from '../core/user-prefs.js'
import { failCommand } from './output.js'

const USAGE = `Usage:
  ccm config                    Open interactive settings UI
  ccm config get [key]          Show one or all values
  ccm config set <key> <value>  Save a setting
  ccm config reset [key]        Reset one or all settings to defaults

Keys:
${Object.entries(PREF_SPECS)
  .map(([k, spec]) => `  ${k.padEnd(12)} ${spec.description}  (${spec.values.join(', ')})`)
  .join('\n')}`

export async function runConfigCommand(args: string[]): Promise<void> {
  const [subcommand, key, value] = args

  switch (subcommand) {
    case undefined: {
      const { runConfigApp } = await import('../tui/ConfigApp.js')
      await runConfigApp()
      return
    }
    case 'get':
      await handleGet(key)
      return
    case 'set':
      await handleSet(key, value)
      return
    case 'reset':
      await handleReset(key)
      return
    case '--help':
    case '-h':
      console.log(USAGE)
      return
    default:
      failCommand(
        `unknown config subcommand: ${subcommand}\n\n${USAGE}`
      )
  }
}

async function handleGet(key?: string): Promise<void> {
  const prefs = await readUserPrefs()

  if (!key) {
    for (const [k, v] of Object.entries(prefs)) {
      console.log(`${k} = ${v}`)
    }
    return
  }

  if (!(key in PREF_SPECS)) {
    failCommand(
      `unknown key: ${key}\nValid keys: ${Object.keys(PREF_SPECS).join(', ')}`
    )
    return
  }
  console.log(prefs[key as keyof typeof prefs])
}

async function handleSet(key?: string, value?: string): Promise<void> {
  if (!key || value === undefined) {
    failCommand('usage: ccm config set <key> <value>')
    return
  }

  if (!(key in PREF_SPECS)) {
    failCommand(
      `unknown key: ${key}\nValid keys: ${Object.keys(PREF_SPECS).join(', ')}`
    )
    return
  }

  const spec = PREF_SPECS[key as keyof typeof PREF_SPECS]
  if (spec.values.length > 0 && !spec.values.includes(value)) {
    failCommand(
      `invalid value for ${key}: ${value}\nValid values: ${spec.values.join(', ')}`
    )
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await setUserPref(key as any, value as any)
  console.log(`${key} = ${value}`)
}

async function handleReset(key?: string): Promise<void> {
  if (key && !(key in PREF_SPECS)) {
    failCommand(
      `unknown key: ${key}\nValid keys: ${Object.keys(PREF_SPECS).join(', ')}`
    )
    return
  }

  await resetUserPrefs(key as keyof typeof PREF_SPECS | undefined)
  const prefs = await readUserPrefs()

  if (key) {
    console.log(`${key} = ${prefs[key as keyof typeof prefs]}  (reset to default)`)
  } else {
    console.log('all settings reset to defaults')
  }
}

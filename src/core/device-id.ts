import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { getCcmDirectory } from './claude-paths.js'

const DEVICE_ID_FILENAME = 'device-id'

/**
 * Returns the persistent device identifier for this machine, creating it on
 * first use. Uses the OS hostname — human-readable, stable across reboots,
 * and unique enough for same-user multi-device setups.
 *
 * Stored at ~/.claude/ccm/device-id so it survives ccm reinstalls and is
 * accessible to the Claude Code agent via its Read tool (enabling the
 * CLAUDE.md "are you linked?" check to work without any ccm process running).
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const idPath = join(getCcmDirectory(), DEVICE_ID_FILENAME)
  try {
    return (await readFile(idPath, 'utf8')).trim()
  } catch {
    const id = hostname()
    await mkdir(getCcmDirectory(), { recursive: true })
    await writeFile(idPath, id, 'utf8')
    return id
  }
}

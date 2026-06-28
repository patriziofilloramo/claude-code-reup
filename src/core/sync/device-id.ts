import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import { getReupDirectory } from '../project/claude-paths.js'

const DEVICE_ID_FILENAME = 'device-id'

/**
 * Returns the persistent device identifier for this machine, creating it on
 * first use. Uses the OS hostname — human-readable, stable across reboots,
 * and unique enough for same-user multi-device setups.
 *
 * Stored at ~/.claude/reup/device-id so it survives reup reinstalls and is
 * accessible to the Claude Code agent via its Read tool (enabling the
 * CLAUDE.md "are you linked?" check to work without any reup process running).
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const idPath = join(getReupDirectory(), DEVICE_ID_FILENAME)
  try {
    return (await readFile(idPath, 'utf8')).trim()
  } catch {
    const id = hostname()
    await mkdir(getReupDirectory(), { recursive: true })
    await writeFile(idPath, id, 'utf8')
    return id
  }
}

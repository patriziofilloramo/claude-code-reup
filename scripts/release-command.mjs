import process from 'node:process'

export function resolveReleaseCommand(command, args) {
  if (process.platform !== 'win32' || command !== 'npm') return { command, args }

  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, ...args],
    }
  }

  if (!process.env.ComSpec) throw new Error('Unable to locate npm on Windows.')
  return {
    command: process.env.ComSpec,
    args: ['/d', '/s', '/c', 'npm', ...args],
  }
}

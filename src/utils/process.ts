/** Returns the current working directory, or undefined if it no longer exists. */
export function readCurrentWorkingDirectory(): string | undefined {
  try {
    return process.cwd()
  } catch {
    return undefined
  }
}

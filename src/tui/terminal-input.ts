/** Stops Ink's input stream from competing with the next interactive process. */
export function releaseTerminalInput(): void {
  try {
    process.stdin.setRawMode(false)
  } catch {
    // stdin is not a TTY.
  }
  process.stdin.pause()
  process.stdin.removeAllListeners()
}

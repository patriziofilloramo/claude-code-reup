/** Writes one human-readable block without adding accidental blank lines. */
export function writeOutput(output: string): void {
  console.log(output.trimEnd())
}

/** Marks a command as failed after printing a concise diagnostic. */
export function failCommand(message: string): void {
  console.error(`ccm: ${message}`)
  process.exitCode = 1
}

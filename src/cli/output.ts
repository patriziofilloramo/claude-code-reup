import { sanitizeTerminalOutput } from './terminal-text.js'

/** Writes one human-readable block without adding accidental blank lines. */
export function writeOutput(output: string): void {
  console.log(sanitizeTerminalOutput(output).trimEnd())
}

/** Writes output produced by a trusted Reup renderer while retaining its SGR styles. */
export function writeStyledOutput(output: string): void {
  console.log(sanitizeTerminalOutput(output, true).trimEnd())
}

/** Marks a command as failed after printing a concise diagnostic. */
export function failCommand(message: string): void {
  console.error(sanitizeTerminalOutput(`reup: ${message}`))
  process.exitCode = 1
}

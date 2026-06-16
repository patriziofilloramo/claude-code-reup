import * as vscode from 'vscode'

export interface SwoopLogger {
  debug(message: string, ...details: unknown[]): void
  error(message: string, error?: unknown): void
  info(message: string, ...details: unknown[]): void
  show(): void
  warn(message: string, ...details: unknown[]): void
}

/** Small Output Channel logger that never writes transcript content. */
export function createLogger(): SwoopLogger {
  const output = vscode.window.createOutputChannel('Swoop')

  function append(level: string, message: string, details: unknown[] = []): void {
    const suffix = details.length > 0 ? ` ${details.map(formatDetail).join(' ')}` : ''
    output.appendLine(`[${new Date().toISOString()}] ${level} ${message}${suffix}`)
  }

  return {
    debug: (message, ...details) => append('DEBUG', message, details),
    error: (message, error) => {
      append('ERROR', message, error === undefined ? [] : [formatError(error)])
    },
    info: (message, ...details) => append('INFO ', message, details),
    show: () => output.show(true),
    warn: (message, ...details) => append('WARN ', message, details),
  }
}

function formatDetail(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return String(value)
  return JSON.stringify(value)
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return formatDetail(error)
}

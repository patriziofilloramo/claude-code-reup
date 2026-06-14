import { spawn } from 'node:child_process'

/** Opens a directory in the platform's file manager (non-blocking). */
export function openDirectory(dirPath: string): void {
  if (process.platform === 'win32') {
    spawn('explorer', [dirPath], { detached: true, stdio: 'ignore' }).unref()
  } else if (process.platform === 'darwin') {
    spawn('open', [dirPath], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('xdg-open', [dirPath], { detached: true, stdio: 'ignore' }).unref()
  }
}

/** Writes text to the system clipboard. Rejects if no clipboard tool is available. */
export function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let cmd: string
    let args: string[]
    if (process.platform === 'win32') {
      cmd = 'clip'
      args = []
    } else if (process.platform === 'darwin') {
      cmd = 'pbcopy'
      args = []
    } else {
      cmd = 'xclip'
      args = ['-selection', 'clipboard']
    }

    const proc = spawn(cmd, args, { shell: process.platform === 'win32' })
    proc.stdin?.write(text, 'utf8')
    proc.stdin?.end()
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${String(code)}`))
    })
    proc.on('error', reject)
  })
}

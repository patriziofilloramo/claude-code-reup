export function windowsCmdLauncher() {
  return ['@echo off', 'node "%~dp0..\\app\\dist\\index.js" %*', ''].join('\r\n')
}

export function windowsPosixLauncher() {
  return [
    '#!/usr/bin/env sh',
    'set -eu',
    'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'exec node "$SCRIPT_DIR/../app/dist/index.js" "$@"',
    '',
  ].join('\n')
}

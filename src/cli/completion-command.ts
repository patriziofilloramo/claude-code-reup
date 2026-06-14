import { getActiveSessions } from '../core/active-sessions.js'
import { loadProjects } from '../core/project-discovery.js'
import { rankSessionCandidates } from '../core/session-ranking.js'
import { readCurrentWorkingDirectory } from '../utils/process.js'
import { failCommand, writeOutput } from './output.js'

type SupportedShell = 'bash' | 'powershell' | 'zsh'

const COMPLETION_SCRIPTS: Record<SupportedShell, string> = {
  bash: [
    '_ccm_complete() {',
    '  local current="${COMP_WORDS[COMP_CWORD]}"',
    '  if [[ "$COMP_CWORD" -eq 2 && ("${COMP_WORDS[1]}" == "resume" || "${COMP_WORDS[1]}" == "handoff") ]]; then',
    '    compopt -o nosort 2>/dev/null || true',
    '    COMPREPLY=( $(ccm __complete-session-ids "$current") )',
    '  fi',
    '}',
    'complete -F _ccm_complete ccm',
  ].join('\n'),
  powershell: String.raw`Register-ArgumentCompleter -Native -CommandName ccm, ccm.cmd -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })
  if ($elements.Count -ge 2 -and $elements[1] -in @('resume', 'handoff')) {
    $ccmCommand = Get-Command ccm.cmd -ErrorAction SilentlyContinue
    if (-not $ccmCommand) { $ccmCommand = Get-Command ccm -ErrorAction SilentlyContinue }
    if ($ccmCommand) {
      & $ccmCommand __complete-session-ids $wordToComplete | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
      }
    }
  }
}`,
  zsh: String.raw`_ccm_complete() {
  if (( CURRENT == 3 )) && [[ "$words[2]" == "resume" || "$words[2]" == "handoff" ]]; then
    compadd -V ccm-sessions -- $(ccm __complete-session-ids "$words[CURRENT]")
  fi
}
compdef _ccm_complete ccm`,
}

const ACTIVATION_INSTRUCTIONS: Record<SupportedShell, string[]> = {
  bash: [
    'Paste the script above into your terminal to activate for this session.',
    'For persistent completion, add this line to ~/.bashrc or ~/.bash_profile:',
    '  eval "$(ccm completion bash)"',
  ],
  zsh: [
    'Paste the script above into your terminal to activate for this session.',
    'For persistent completion, add this line to ~/.zshrc:',
    '  eval "$(ccm completion zsh)"',
  ],
  powershell: [
    'Paste the script above into your PowerShell session to activate for this session.',
    'For persistent completion, add this line to your $PROFILE:',
    '  ccm completion powershell | Out-String | Invoke-Expression',
  ],
}

/** Prints a shell-native completion registration script to stdout with activation instructions on stderr. */
export function printCompletionScript(commandArguments: string[]): void {
  if (commandArguments.length !== 1 || !isSupportedShell(commandArguments[0])) {
    failCommand('usage: ccm completion <powershell|bash|zsh>')
    return
  }

  const shell = commandArguments[0]
  writeOutput(COMPLETION_SCRIPTS[shell])

  const lines = ACTIVATION_INSTRUCTIONS[shell]
  process.stderr.write('\n# ── Activation ──────────────────────────────────────────────────\n')
  for (const line of lines) {
    process.stderr.write(`# ${line}\n`)
  }
  process.stderr.write('# ────────────────────────────────────────────────────────────────\n')
}

/** Prints exact session IDs for the shell completion scripts. */
export async function printSessionIdCompletions(commandArguments: string[]): Promise<void> {
  if (commandArguments.length > 1) return

  const prefix = (commandArguments[0] ?? '').toLowerCase()
  const [projects, activeSessionIds] = await Promise.all([loadProjects(), getActiveSessions()])
  const matchingIds = rankSessionCandidates(
    projects,
    activeSessionIds,
    readCurrentWorkingDirectory()
  )
    .map(({ session }) => session.id)
    .filter((sessionId) => sessionId.toLowerCase().startsWith(prefix))

  if (matchingIds.length > 0) writeOutput(matchingIds.join('\n'))
}

function isSupportedShell(value: string): value is SupportedShell {
  return value === 'powershell' || value === 'bash' || value === 'zsh'
}

# Installation And Distribution

Swoop should feel native to install while remaining transparent about changes to
the user's machine.

## Installation Principles

- Offer one obvious installer per supported platform.
- Never require a repository clone, TypeScript build, or `npm link`.
- Keep installation per-user by default and avoid administrator privileges.
- Show optional shell integration before applying it.
- Make every integration idempotent, inspectable, and reversible.
- Do not modify shell profiles from npm `postinstall`.

## Windows Installer

The Windows installer should install a self-contained Swoop executable or launcher
and add it to the current user's `PATH`.

It should offer a pre-selected option:

> Enable PowerShell tab completion for `swoop resume` and `swoop handoff`

When accepted, the installer should:

1. Install a versioned completion script inside Swoop's installation directory.
2. Detect Windows PowerShell 5.1 and PowerShell 7 profiles separately.
3. Create missing profile files and parent directories when necessary.
4. Back up an existing profile before its first Swoop modification.
5. Add one clearly marked managed block that sources the installed completion
   script.
6. Avoid duplicate blocks on repair or upgrade.
7. Remove only the managed block during uninstall.

Example managed profile block:

```powershell
# >>> swoop completion >>>
. "$env:LOCALAPPDATA\Programs\swoop\completion\swoop.ps1"
# <<< swoop completion <<<
```

The installer must not weaken PowerShell execution policy. The installed
launcher should work even when npm-generated `.ps1` shims are blocked.

## macOS And Linux

Package-manager installation should place completion files in standard
locations when supported:

- Bash: an appropriate `bash-completion` directory
- Zsh: a directory on `fpath`

When no standard completion directory is available, the installer may offer an
explicit managed shell-profile block with the same backup and uninstall rules
as Windows.

## Development Installation

Until native installers exist, contributors use the repository workflow:

```text
npm install
npm run build
npm link
```

Shell completion remains opt-in through `swoop completion <shell>`. A future
managed `swoop config` interface may install or remove the same integration after
showing the exact profile changes; it must follow the backup and ownership
rules above.

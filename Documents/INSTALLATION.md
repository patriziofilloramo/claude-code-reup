# Installation And Distribution

Reup should feel native to install while remaining transparent about every
change it makes to the user's machine.

## Release Channel

GitHub Releases are the primary distribution channel for the first public
release. Each release should contain:

- Windows signed `.exe` installer.
- macOS signed and notarized universal archive or installer.
- Linux `.deb`, `.rpm`, and `.tar.gz`.
- VS Code `.vsix`.
- `SHA256SUMS.txt` covering every artifact.
- Detached signatures for release assets.
- SBOM.
- Provenance attestations where CI supports them.
- Human release notes with install, upgrade, rollback, and known-risk notes.

## Local Release Candidate

The first Milestone 9 phase is a local release candidate only. It prepares the
best available artifacts and evidence without publishing anything:

```text
npm run release:local
```

The command refuses a dirty working tree by default. For script development
only, pass `-- --allow-dirty`; those artifacts are clearly marked as local
validation output and must not be distributed.

The local release folder is written under `release/` and contains:

- the npm package tarball from `npm pack`;
- the packaged VS Code `.vsix`;
- a source archive when built from a clean commit;
- root and extension CycloneDX SBOMs from `npm sbom`;
- `provenance.local.json`;
- `RELEASE_NOTES.md`;
- `SHA256SUMS.txt`.

This local RC intentionally skips official publish, signing, notarization,
detached signatures, CI-backed attestations, and native installer generation.

## Local Installable Packages

After the local RC path is healthy, build per-platform installable RC packages:

```text
npm run release:installers
```

This command runs `npm run release:local` first, then adds installable packages
under the same release folder:

- `installers/reup-setup-windows-x64-v<version>.exe` when Inno Setup is installed;
- `installers/reup-windows-x64-v<version>.zip`;
- `installers/reup-macos-universal-v<version>.tar.gz`;
- `installers/reup-linux-x64-v<version>.tar.gz`;
- `INSTALLERS.md` with smoke-test instructions;
- updated `SHA256SUMS.txt`.

These packages include the built Reup app and production `node_modules`, but
still require Node.js 20 or newer on the target machine. They install per-user
only and are meant for clean-machine validation before signed native installers.
The Windows `.exe` is built with Inno Setup 6 when available:

```text
winget install --id JRSoftware.InnoSetup -e
```

If Inno Setup is missing, `release:installers` still creates the portable
Windows zip and writes `WINDOWS_EXE_INSTALLER_SKIPPED.txt`. These artifacts do
not publish anything, sign artifacts, notarize macOS output, or produce `.deb`
/ `.rpm` packages.

The Windows `.exe` shows installer tasks for adding `reup` to the current user
`PATH` and enabling PowerShell tab completion for Windows PowerShell 5.1 and
PowerShell 7. Completion is implemented through clearly marked managed profile
blocks and removed during uninstall.

## Platform Matrix

| Platform            | Artifact                      | Install goal                        | Verification                     |
| ------------------- | ----------------------------- | ----------------------------------- | -------------------------------- |
| Windows x64         | `reup-setup-windows-x64.exe`  | Per-user install, `reup` on PATH    | Authenticode signature + SHA-256 |
| macOS universal     | `reup-macos-universal.tar.gz` | Signed/notarized executable on PATH | Notarization + SHA-256           |
| Linux Debian/Ubuntu | `.deb`                        | Package-managed install/uninstall   | SHA-256 + package metadata       |
| Linux Fedora/RHEL   | `.rpm`                        | Package-managed install/uninstall   | SHA-256 + package metadata       |
| Linux generic       | `.tar.gz`                     | Portable install for power users    | SHA-256                          |
| VS Code             | `.vsix`                       | Manual extension install            | SHA-256                          |

The local RC installable packages intentionally cover the portable/package
shape first. Unsigned Windows `.exe` generation is available with Inno Setup;
signed Windows artifacts, package-manager Linux artifacts, and macOS
notarization remain official-release work.

## Installer Principles

- Offer one obvious installer per supported platform.
- Never require a repository clone, TypeScript build, or `npm link` for normal
  users.
- Keep installation per-user by default and avoid administrator privileges.
- Add `reup` to PATH in a reversible way.
- Show optional shell integration before applying it.
- Make every integration idempotent, inspectable, and reversible.
- Do not modify shell profiles from npm `postinstall`.
- Never install auto-update behavior in the first public release.

## Windows Installer

The Windows installer should install a signed self-contained Reup executable or
launcher and add it to the current user's `PATH`.

It may offer a pre-selected option:

> Enable PowerShell tab completion for `reup resume` and `reup handoff`

When accepted, the installer should:

1. Install a versioned completion script inside Reup's installation directory.
2. Detect Windows PowerShell 5.1 and PowerShell 7 profiles separately.
3. Create missing profile files and parent directories when necessary.
4. Back up an existing profile before its first Reup modification.
5. Add one clearly marked managed block that sources the installed completion
   script.
6. Avoid duplicate blocks on repair or upgrade.
7. Remove only the managed block during uninstall.

Example managed profile block:

```powershell
# >>> reup completion >>>
. "$env:LOCALAPPDATA\Programs\reup\completion\reup.ps1"
# <<< reup completion <<<
```

The installer must not weaken PowerShell execution policy. The installed
launcher should work even when `.ps1` shims are blocked.

## macOS

The macOS artifact must be signed and notarized before broad distribution. The
install path should be clear, reversible, and compatible with a non-admin user
where possible.

When shell completion is offered, the installer should prefer standard shell
completion locations. If it must edit a profile, it must use the same managed
block, backup, and uninstall rules as Windows.

## Linux

Provide `.deb` and `.rpm` packages for users who want package-manager upgrade
and uninstall behavior. Also provide a `.tar.gz` for power users and
distributions not covered by the packages.

Package scripts may install completion files into standard completion
directories when supported. They should not silently rewrite user shell
profiles.

## Validation

Before shipping a release, validate on clean Windows, macOS, and Linux
environments:

- install;
- PATH discovery;
- first `reup --version`;
- first `reup doctor`;
- `reup web` binds to localhost only;
- VSIX install;
- upgrade over the previous release;
- uninstall;
- checksum verification;
- signature/notarization verification where applicable.

Before creating a local release candidate, `npm run release:local` runs the
repository gate: version sync, format check, lint, build, tests, extension
build/package/smoke, browser-client syntax check, npm audits, and diff
whitespace checks.

## Development Installation

Contributors can use the repository workflow:

```text
npm install
npm run build
npm link
```

Shell completion remains opt-in through `reup completion <shell>`.

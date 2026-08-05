# Installation And Distribution

Reup's beta path has one canonical package: the scoped public npm tarball. GitHub Actions produces
the same candidate plus supporting evidence for review. Nothing in the repository publishes a
package, creates a GitHub Release, or updates the VS Code Marketplace automatically.

## Canonical Beta Install

After the owner has explicitly promoted a beta to npm, the normal install and upgrade commands will
be:

```text
npm install --global @patriziofilloramo/reup@beta
reup --version
reup doctor
```

An ordinary interactive `reup`, `reup web`, or `reup config` launch automatically registers Reup's
Claude Code attention hooks when they are absent and reports that write in the terminal. This makes
turn-boundary monitoring work without a hidden setup prerequisite. `reup attention remove` removes
the entries and records the opt-out so a later launch does not silently add them again. Usage
capture remains separately opt-in.

Remove integrations while the command still exists, then uninstall the package:

```text
reup usage remove
reup attention remove
npm uninstall --global @patriziofilloramo/reup
```

Both removal commands are safe when their integration is not configured. npm removes the program,
but deliberately leaves Reup-owned preferences, aliases, archive markers, and caches under
`~/.claude/reup/` and project `reup.json` files. Review and remove those paths separately only when
their local metadata is no longer wanted.

These commands describe the prepared channel; they are not evidence that a beta is currently
published. Before announcing them publicly, verify the package and `beta` dist-tag on npm from a
clean machine.

npm is the canonical beta channel because Reup already requires Node.js 20 or newer and npm gives
Windows, macOS, and Linux users one install path. The sequence above makes Reup's external
integrations reversible as well. Native installers remain a later distribution layer, not a
prerequisite for beta validation.

## Package Dry-Run

Run the focused npm package check while iterating on packaging:

```text
npm run release:package:check
```

It executes `npm pack --dry-run --json`, including the package's `prepack` build, then verifies:

- public scoped-package metadata and registry policy;
- the CLI entry point and required runtime/web assets;
- privacy, security, support, disclaimer, license, and README files;
- an allowlisted package root plus absence of source, tests, scripts, extension sources, repository
  metadata, and unsafe archive paths;
- package size and file-count ceilings;
- the integrity hash reported by npm.

The complete release gate is:

```text
npm run release:check
```

That gate runs version sync, formatting, lint, build, tests, VS Code build/package checks and a
development-host smoke, browser-client syntax validation, root and extension audits, the npm
dry-run above, and Git whitespace validation. CI also runs the package and VSIX checks on Linux for
every pull request.

## Local Release Candidate

Create the complete candidate locally with:

```text
npm run release:local
```

The command refuses a dirty working tree. For script development only, pass
`-- --allow-dirty`; the resulting folder is marked dirty, omits the source archive, and must not be
distributed.

`release/reup-v<version>-<commit>/` contains only artifacts that were actually generated:

- `artifacts/*.tgz`: the npm package candidate;
- `artifacts/reup-vscode-<version>.vsix`: the manually installable VS Code candidate;
- `artifacts/reup-source-*.zip` for a clean commit, or an explicit skipped notice for a dirty run;
- root and extension CycloneDX SBOMs;
- `build-metadata.json`, which records the build and checks but is explicitly not an attestation;
- `RELEASE_NOTES.md` and `SHA256SUMS.txt`.

Before the folder is reported ready, the script:

- verifies that the release gate and final pack did not change a previously clean source tree;
- extracts the manifest and README from the exact `.tgz`, validates that artifact's identity,
  metadata, paths, size, integrity report, and shipped links, then installs it into an isolated
  prefix;
- confirms npm created the local `reup` shim and runs that installed command with `--version`;
- includes the already packaged VSIX only after its exact archive and manifests pass the policy
  described below.

It does not publish to npm, create a GitHub Release, publish the VSIX, sign, notarize, or generate
native installers.

The CycloneDX files are dependency snapshots of the lockfile-backed root and extension build
environments. They are useful build evidence, but they are not a promise of the dependency closure
on every later npm install: the tarball declares allowed runtime ranges, and npm may resolve newer
range-compatible versions at install time. `build-metadata.json` and the generated release notes
state this limitation explicitly.

### VSIX checks

`npm run release:extension:check` inspects the exact VSIX archive. It enforces its size and complete
file allowlist, rejects duplicate or unsafe paths, reads the packaged `extension/package.json`, and
checks the generated `extension.vsixmanifest` identity, version, publisher, VS Code target, and code
manifest reference.

`npm run test:extension-host` is a separate runtime smoke: it compiles and activates the development
checkout in a pinned VS Code Extension Host. It proves command registration and basic activation,
but it does not install or execute the VSIX bytes. Therefore the promotion checklist still requires
a manual install of the exact VSIX on clean target machines.

## GitHub Actions Candidate

The manual **Beta Candidate** workflow runs the same `release:local` command on a clean Linux
runner and uploads the resulting folder as a GitHub Actions artifact for 14 days. The workflow has
read-only repository permissions and no npm token or OIDC publication permission.

This is a review and testing artifact, not a GitHub Release and not a public install channel. A
tester can download it from the workflow run and install the tarball directly:

```text
npm install --global ./patriziofilloramo-reup-<version>.tgz
reup --version
reup doctor
```

The VSIX in the same bundle can be installed manually from VS Code's **Install from VSIX...**
command.

## Optional Local Installers

Portable/native-shaped packages are retained for clean-machine experiments, but they are not the
canonical beta channel:

```text
npm run release:installers
```

This command runs `release:local`, extracts the verified npm tarball, adds production dependencies
from the lockfile, and packages only the current host platform. It deliberately does not cross-build
macOS or Linux archives with dependencies resolved for Windows, or vice versa.

Current output by host:

| Host        | Output                                                               |
| ----------- | -------------------------------------------------------------------- |
| Windows x64 | Portable `.zip`; unsigned Inno Setup `.exe` when Inno Setup 6 exists |
| macOS       | Host-architecture `.tar.gz`                                          |
| Linux       | Host-architecture `.tar.gz`                                          |

Every package still requires Node.js 20 or newer, installs per-user, and is unsigned/not notarized.
The command writes `INSTALLERS.md` from the files it actually generated. If Inno Setup is absent on
Windows, the zip is still produced and `WINDOWS_EXE_INSTALLER_SKIPPED.txt` records the omission.

Install Inno Setup 6 when an unsigned Windows RC installer is specifically needed:

```text
winget install --id JRSoftware.InnoSetup -e
```

To test the newest Windows zip on the current development machine:

```text
npm run install:cli
npm run uninstall:cli
```

Those commands modify the current user's real PATH. They do not build artifacts; run
`release:installers` first. The Windows `.exe` can optionally add PowerShell completion through a
clearly marked, idempotent profile block that uninstall removes.

## Promotion Checklist

Promotion remains an explicit owner/release-manager action outside the build scripts:

1. Choose and synchronize a new, never-published version; build from a reviewed clean commit.
2. Run the Beta Candidate workflow and download its artifact.
3. Verify `SHA256SUMS.txt`, build metadata, SBOMs, npm tarball install, CLI health, and VSIX smoke on
   clean Windows, macOS, and Linux machines.
4. Confirm ownership of the `@patriziofilloramo` npm scope and configure npm authentication or a
   trusted publisher with least privilege.
5. Publish the exact verified tarball under the `beta` dist-tag; do not publish by rebuilding it.
6. Verify package contents, provenance when the publication environment supports it, dist-tags,
   install, upgrade, and uninstall from the public registry.
7. Create a GitHub pre-release manually and upload only existing verified artifacts plus checksums,
   SBOMs, and release notes.
8. Announce the beta only after both public channels have been independently checked.

For the 0.x line, `beta` is the npm distribution channel, not a SemVer prerelease suffix. A stable
version such as `0.4.0` may first be distributed under the `beta` tag. npm versions are immutable:
never rebuild or attempt to republish that version. If validation requires any code or packaging
change, increment to a new version such as `0.4.1` and produce a new candidate. If the exact
`0.4.0` artifact is accepted unchanged, it may later be promoted by moving the npm `latest` tag to
that already published version; it must not be rebuilt.

Signing, macOS notarization, detached signatures, CI-backed attestations, `.deb`, `.rpm`, and
self-contained executables are future official-release work. They must not be promised as current
artifacts until the corresponding build and verification paths exist.

## Installer Principles

- Offer one obvious canonical beta install path.
- Never require a repository clone, TypeScript build, or `npm link` for normal users.
- Keep installation per-user by default and avoid administrator privileges.
- Keep PATH and shell integrations opt-in, idempotent, inspectable, and reversible.
- Do not modify shell profiles from npm `postinstall`; Reup intentionally has no postinstall hook.
- Never install auto-update behavior in the first public release.
- Treat a workflow artifact, npm publication, GitHub Release, signature, notarization, and
  attestation as distinct claims backed by distinct evidence.

## Development Installation

Contributors can still use:

```text
npm install
npm run build
npm link
```

Shell completion remains opt-in through `reup completion <shell>`.

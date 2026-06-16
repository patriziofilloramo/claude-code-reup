import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

const buildOptions = {
  bundle: true,
  entryPoints: ['src/extension.ts'],
  external: ['vscode'],
  format: 'cjs',
  logLevel: 'info',
  outfile: 'dist/extension.cjs',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
}

if (watch) {
  const context = await esbuild.context(buildOptions)
  await context.watch()
  console.log('Swoop VS Code extension build is watching for changes.')
} else {
  await esbuild.build(buildOptions)
}

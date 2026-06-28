import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

const buildOptions = {
  bundle: true,
  entryNames: '[name]',
  entryPoints: {
    extension: 'src/extension.ts',
    'smoke-test': 'src/smoke-test.ts',
  },
  external: ['vscode'],
  format: 'cjs',
  logLevel: 'info',
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  sourcemap: true,
  target: 'node20',
}

if (watch) {
  const context = await esbuild.context(buildOptions)
  await context.watch()
  console.log('Reup VS Code extension build is watching for changes.')
} else {
  await esbuild.build(buildOptions)
}

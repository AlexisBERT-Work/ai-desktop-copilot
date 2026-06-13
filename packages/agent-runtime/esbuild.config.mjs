// Production bundler for the NeuroDesk agent runtime.
//
// We bundle the TypeScript entry (resolving the `@neurodesk/shared-types`
// path alias and inlining first-party code + light deps like zod) into a
// single CommonJS file that a portable `node.exe` can run directly.
//
// `sql.js` and `playwright-core` are kept EXTERNAL: both resolve auxiliary
// files at runtime (`sql-wasm.wasm`, browser binaries) via require.resolve /
// __dirname, which only works when their real package folders sit in a
// sibling `node_modules/`. The release build ships that node_modules next to
// this bundle (see scripts/build-release.ps1).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  // esbuild reads `compilerOptions.paths` from this tsconfig to resolve the
  // workspace alias to ../shared-types/src.
  tsconfig: 'tsconfig.json',
  external: ['sql.js', 'playwright-core'],
  logLevel: 'info',
  banner: {
    // CJS bundle but some deps probe for ESM globals; keep a stable __dirname.
    js: '',
  },
});

console.log('[esbuild] agent runtime bundled → dist/index.js');

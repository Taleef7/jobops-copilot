import { context, build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const isWatch = process.argv.includes('--watch');

const entryPoints = {
  background: 'src/background/index.ts',
  options: 'src/options/options.ts',
  popup: 'src/popup/popup.ts',
};

const buildOptions = {
  entryPoints,
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: ['chrome110'],
  sourcemap: true,
  minify: !isWatch,
  logLevel: 'info',
};

async function run() {
  await mkdir(join(process.cwd(), 'dist'), { recursive: true });

  if (isWatch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    console.log('[esbuild] Watching for changes in extensions/chrome/src...');
  } else {
    await build(buildOptions);
    console.log('[esbuild] Extension bundle created in extensions/chrome/dist/');
  }
}

run().catch((err) => {
  console.error('[esbuild] Build error:', err);
  process.exit(1);
});

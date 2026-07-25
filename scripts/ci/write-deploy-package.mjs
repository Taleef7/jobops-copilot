#!/usr/bin/env node
/**
 * Build `apps/api/.deploy/package.json` with every production dependency pinned
 * to the EXACT version the workspace install resolved.
 *
 * Why not just copy the root `package-lock.json` and run `npm ci`?
 * That was the old approach and it is only correct while every api dependency
 * happens to be *hoisted* to the root `node_modules`. It broke the moment two
 * workspaces wanted different majors of the same package: undici@8 (api) ended
 * up nested at `apps/api/node_modules/undici` because jsdom + shadcn pin
 * undici@7 at the root, so `npm ci` in the copied package failed with
 *   `Invalid: lock file's undici@7.28.0 does not satisfy undici@8.9.0`
 * and the API silently stopped deploying.
 *
 * Reading the resolved version out of the installed tree keeps the deploy
 * deterministic (exact pins, no semver re-resolve) without depending on where
 * npm chose to place each package.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiDir = join(repoRoot, 'apps', 'api');
const deployDir = join(apiDir, '.deploy');

const pkg = JSON.parse(readFileSync(join(apiDir, 'package.json'), 'utf8'));
const deps = pkg.dependencies ?? {};

// Resolve from the api workspace so a nested (non-hoisted) install wins over
// whatever version happens to sit at the repo root.
const require = createRequire(join(apiDir, 'package.json'));

const pinned = {};
const unresolved = [];
for (const name of Object.keys(deps).sort()) {
  try {
    const manifestPath = require.resolve(`${name}/package.json`);
    pinned[name] = JSON.parse(readFileSync(manifestPath, 'utf8')).version;
  } catch {
    // Packages without an exported `./package.json` still resolve as a module.
    try {
      const entry = require.resolve(name);
      const version = findVersionUpwards(entry, name);
      if (!version) throw new Error('no manifest');
      pinned[name] = version;
    } catch {
      unresolved.push(name);
    }
  }
}

if (unresolved.length > 0) {
  console.error(
    `Could not resolve installed versions for: ${unresolved.join(', ')}.\n` +
      'Run `npm ci` at the repo root before assembling the deploy package.',
  );
  process.exit(1);
}

/** Walk up from a resolved entry point to the owning package's manifest. */
function findVersionUpwards(entry, name) {
  let dir = dirname(entry);
  for (let i = 0; i < 10; i += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (manifest.name === name && manifest.version) return manifest.version;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

mkdirSync(deployDir, { recursive: true });
writeFileSync(
  join(deployDir, 'package.json'),
  `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      private: true,
      engines: pkg.engines,
      // App Service runs `node dist/server.js`; keep the same entry contract.
      scripts: { start: pkg.scripts?.start ?? 'node dist/server.js' },
      dependencies: pinned,
    },
    null,
    2,
  )}\n`,
);

console.log(`Pinned ${Object.keys(pinned).length} production dependencies:`);
for (const [name, version] of Object.entries(pinned)) {
  console.log(`  ${name}@${version}`);
}

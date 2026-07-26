#!/usr/bin/env node
/**
 * Assemble `apps/api/.deploy` — the self-contained package shipped to App
 * Service — from the dependency tree the current `npm ci` already installed and
 * tested, rather than re-resolving one.
 *
 * History, because two obvious approaches are both wrong:
 *
 * 1. Copy the repo-root `package-lock.json` next to `apps/api/package.json` and
 *    run `npm ci`. Only works while every api dependency is hoisted to the root
 *    `node_modules`. undici@8 installs nested at `apps/api/node_modules/undici`
 *    (jsdom + shadcn hold undici@7 at the root), so npm compared the api
 *    manifest against the root lock entry and failed with "lock file's
 *    undici@7.28.0 does not satisfy undici@8.9.0" — the API stopped deploying.
 *
 * 2. Pin the direct dependencies exactly and `npm install` the rest. Transitive
 *    ranges get re-resolved, so a release published between CI and deploy ships
 *    untested. Pinning the whole closure via `overrides` cannot work either:
 *    the api's production closure legitimately contains two versions of the
 *    same package (express 5 wants type-is@2, applicationinsights wants
 *    type-is@1.6.18; several @opentelemetry/* packages likewise), and a flat
 *    override map has one slot per name.
 *
 * So: walk the root lockfile from the api's production dependencies to get the
 * exact set of installed paths, then COPY those paths out of the tested
 * `node_modules`, preserving nesting. Duplicate versions keep their nested
 * locations, node resolves them exactly as it did in CI, and nothing is
 * re-resolved. Dev dependencies are never copied.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const apiWorkspace = 'apps/api';
const deployDir = join(repoRoot, apiWorkspace, '.deploy');

const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));

/**
 * Resolve `name` as required from the package at lockfile path `fromPath`,
 * mirroring node's lookup: `<fromPath>/node_modules/<name>`, then each ancestor
 * directory's `node_modules`, ending at the root.
 */
function resolveEntry(fromPath, name) {
  const segments = fromPath === '' ? [] : fromPath.split('/');
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const prefix = segments.slice(0, depth).join('/');
    const candidate = prefix ? `${prefix}/node_modules/${name}` : `node_modules/${name}`;
    const entry = lock.packages[candidate];
    if (entry) return { path: candidate, entry };
  }
  return null;
}

/**
 * Where a lockfile path lands inside the deploy package. The api workspace
 * becomes the package root, so its nested modules hoist to the top; every other
 * path keeps its shape so nested duplicates stay nested.
 */
function deployPathFor(lockPath) {
  return lockPath.startsWith(`${apiWorkspace}/`)
    ? lockPath.slice(apiWorkspace.length + 1)
    : lockPath;
}

/** Every installed path reachable from the api's production dependencies. */
function collectClosure() {
  const apiEntry = lock.packages[apiWorkspace];
  if (!apiEntry) throw new Error(`No "${apiWorkspace}" entry in package-lock.json`);

  const direct = Object.keys(apiEntry.dependencies ?? {});
  /** @type {Map<string, {version: string, name: string}>} lock path -> package */
  const paths = new Map();
  /** @type {Map<string, string>} direct dependency name -> version */
  const directVersions = new Map();
  const queue = direct.map((name) => ({ name, fromPath: apiWorkspace, isDirect: true }));
  const missingDirect = [];

  while (queue.length > 0) {
    const { name, fromPath, isDirect } = queue.shift();
    const resolved = resolveEntry(fromPath, name);
    if (!resolved) {
      // Optional and peer edges are legitimately absent (platform-specific
      // binaries, optional peers). A missing *direct* dependency is fatal.
      if (isDirect) missingDirect.push(name);
      continue;
    }

    const { path, entry } = resolved;
    if (isDirect && entry.version) directVersions.set(name, entry.version);

    if (paths.has(path)) continue;
    paths.set(path, { version: entry.version, name });

    // Production edges only — a transitive package's devDependencies are never installed.
    for (const dep of [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}),
    ]) {
      queue.push({ name: dep, fromPath: path, isDirect: false });
    }
  }

  return { direct, directVersions, paths, missingDirect };
}

function assemble() {
  const { direct, directVersions, paths, missingDirect } = collectClosure();

  if (missingDirect.length > 0) {
    console.error(
      `Direct dependencies missing from the lockfile: ${missingDirect.join(', ')}.\n` +
        'Run `npm install` at the repo root to refresh package-lock.json.',
    );
    process.exit(1);
  }

  // Two lockfile paths must never map onto the same deploy path — that would
  // silently overwrite one version with another.
  const claimed = new Map();
  for (const lockPath of paths.keys()) {
    const target = deployPathFor(lockPath);
    const existing = claimed.get(target);
    if (existing && existing !== lockPath) {
      console.error(
        `Deploy layout collision at "${target}": both "${existing}" and "${lockPath}" map there.\n` +
          'Shipping either would change which version a dependent resolves.',
      );
      process.exit(1);
    }
    claimed.set(target, lockPath);
  }

  const pkg = JSON.parse(readFileSync(join(repoRoot, apiWorkspace, 'package.json'), 'utf8'));
  const dependencies = {};
  for (const name of [...direct].sort()) dependencies[name] = directVersions.get(name);

  rmSync(join(deployDir, 'node_modules'), { recursive: true, force: true });
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
        dependencies,
      },
      null,
      2,
    )}\n`,
  );

  let copied = 0;
  let skipped = 0;
  for (const lockPath of paths.keys()) {
    const source = join(repoRoot, lockPath);
    if (!existsSync(source)) {
      // Optional dependency not installed on this platform.
      skipped += 1;
      continue;
    }
    // Copy the package directory itself without its nested node_modules; those
    // nested packages are separate closure entries copied on their own turn, so
    // anything outside the closure (a dev-only nested tree) never comes along.
    cpSync(source, join(deployDir, deployPathFor(lockPath)), {
      recursive: true,
      dereference: true,
      // Exclude node_modules *inside* this package — those nested packages are
      // separate closure entries copied on their own turn, so a dev-only nested
      // tree never comes along. The check is on the path relative to `source`,
      // since `source` itself always sits under a node_modules directory.
      filter: (src) => {
        const rel = relative(source, src);
        return rel === '' || !rel.split(/[\\/]/).includes('node_modules');
      },
    });
    copied += 1;
  }

  console.log(
    `Assembled .deploy from the tested install: ${direct.length} direct dependencies, ` +
      `${copied} packages copied${skipped ? `, ${skipped} optional packages absent` : ''}.`,
  );
}

/** Walk an installed node_modules tree, yielding [name, version] pairs. */
function* installedPackages(nodeModulesDir) {
  if (!existsSync(nodeModulesDir)) return;
  for (const entry of readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    const dir = join(nodeModulesDir, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of readdirSync(dir, { withFileTypes: true })) {
        if (scoped.isDirectory()) yield* readManifest(join(dir, scoped.name));
      }
      continue;
    }
    yield* readManifest(dir);
  }
}

function* readManifest(packageDir) {
  const manifestPath = join(packageDir, 'package.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.name && manifest.version) yield [manifest.name, manifest.version];
    } catch {
      // A malformed nested manifest is not ours to police.
    }
  }
  yield* installedPackages(join(packageDir, 'node_modules'));
}

/**
 * Assert the assembled tree matches the lockfile exactly: every copied package
 * carries the locked version, and every closure path that exists upstream made
 * it across.
 */
function verify() {
  const { paths } = collectClosure();

  const expected = new Map();
  for (const [lockPath, info] of paths) {
    if (existsSync(join(repoRoot, lockPath))) {
      expected.set(deployPathFor(lockPath), info);
    }
  }

  const missing = [];
  for (const [deployPath, info] of expected) {
    const manifest = join(deployDir, deployPath, 'package.json');
    if (!existsSync(manifest)) {
      missing.push(`${deployPath} (${info.name}@${info.version})`);
      continue;
    }
    const installed = JSON.parse(readFileSync(manifest, 'utf8')).version;
    if (installed !== info.version) {
      missing.push(`${deployPath}: shipped ${installed}, lockfile ${info.version}`);
    }
  }

  if (missing.length > 0) {
    console.error(
      `Deploy package does not match the tested lockfile:\n  ${missing.slice(0, 20).join('\n  ')}` +
        `${missing.length > 20 ? `\n  …and ${missing.length - 20} more` : ''}\n` +
        'Refusing to ship a tree CI did not exercise.',
    );
    process.exit(1);
  }

  // Nothing outside the production closure should have come along.
  let shipped = 0;
  for (const _ of installedPackages(join(deployDir, 'node_modules'))) shipped += 1;

  console.log(
    `Verified ${expected.size} packages match the root lockfile (${shipped} present in the package).`,
  );
}

if (process.argv.includes('--verify')) {
  verify();
} else {
  assemble();
}

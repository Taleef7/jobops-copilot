/* global console, process */

import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function findTestFiles(rootDir) {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...findTestFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const testFiles = [
  ...findTestFiles(join(projectRoot, 'src')),
  ...findTestFiles(join(projectRoot, 'scripts')),
];

if (testFiles.length === 0) {
  console.error('No test files found under apps/api/src or apps/api/scripts');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...testFiles], {
  cwd: projectRoot,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);

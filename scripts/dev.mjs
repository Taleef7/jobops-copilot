import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npmCommand = isWin ? 'npm.cmd' : 'npm';

const processes = new Set();
let shuttingDown = false;

function start(name, args) {
  const child = spawn(npmCommand, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });

  processes.add(child);

  child.on('exit', (code, signal) => {
    processes.delete(child);

    if (shuttingDown) {
      return;
    }

    if (code && code !== 0) {
      shuttingDown = true;
      for (const proc of processes) {
        proc.kill();
      }
      process.exit(code);
    }

    if (signal) {
      shuttingDown = true;
      for (const proc of processes) {
        proc.kill();
      }
      process.exit(1);
    }
  });

  child.on('error', (error) => {
    shuttingDown = true;
    console.error(`[${name}] failed to start`, error);
    for (const proc of processes) {
      proc.kill();
    }
    process.exit(1);
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const proc of processes) {
    proc.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('web', ['run', 'dev:web']);
start('api', ['run', 'dev:api']);

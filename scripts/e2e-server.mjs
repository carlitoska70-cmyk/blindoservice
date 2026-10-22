// Isolated server for end-to-end tests: production build, throwaway database in
// .wrangler/e2e-state, credentials from the environment (generated per run).
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const state = '.wrangler/e2e-state';
const port = process.env.E2E_PORT || '8799';
const wrangler = ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js'];
fs.rmSync(state, { recursive: true, force: true });
for (const args of [
  ['d1', 'migrations', 'apply', 'DB', '--local', '--config', 'wrangler.local.json', '--persist-to', state],
  [
    'd1',
    'execute',
    'DB',
    '--local',
    '--config',
    'wrangler.local.json',
    '--persist-to',
    state,
    '--file',
    'scripts/admin-login-schema.sql',
  ],
]) {
  const r = spawnSync(process.execPath, [...wrangler, ...args], {
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
// Local OpenAI stand-in, so the live assistant can be exercised end to end.
const mock = spawn(process.execPath, ['scripts/e2e-openai-mock.mjs'], { stdio: 'inherit' });
const child = spawn(
  process.execPath,
  [
    ...wrangler,
    'dev',
    '--config',
    'dist/server/wrangler.json',
    '--local',
    '--persist-to',
    state,
    '--ip',
    '127.0.0.1',
    '--port',
    port,
    '--inspector-port',
    '0',
    '--var',
    'PRESIDIO_ADMIN_CREDENTIALS:' + process.env.E2E_OWNER_CREDENTIALS,
    '--var',
    'PRESIDIO_STAFF_CREDENTIALS:' + process.env.E2E_STAFF_CREDENTIALS,
    // Hourly holding signal: /cdn-cgi/handler/scheduled runs the cron, a fake centrale receives it.
    '--var',
    `HOLDING_URL:http://127.0.0.1:${process.env.E2E_HOLDING_PORT}/api/holding/segnale`,
    '--var',
    'HOLDING_SEGNALE_KEY:' + process.env.E2E_HOLDING_KEY,
    '--var',
    'OPENAI_API_KEY:sk-e2e-mock',
    '--var',
    'OPENAI_BASE_URL:http://127.0.0.1:' + (process.env.E2E_OPENAI_PORT || '8797'),
  ],
  { stdio: 'inherit' },
);
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    mock.kill(sig);
    child.kill(sig);
  });
child.on('exit', code => {
  mock.kill();
  process.exit(code ?? 0);
});

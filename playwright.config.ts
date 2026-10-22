import { defineConfig, devices } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

// Fresh credentials per run, shared with the isolated server and the tests via env.
if (!process.env.E2E_OWNER_PASSWORD) {
  for (const [who, email] of [
    ['OWNER', 'titolare@e2e.test'],
    ['STAFF', 'collaboratore@e2e.test'],
  ]) {
    const password = randomBytes(32).toString('base64url');
    process.env[`E2E_${who}_PASSWORD`] = password;
    process.env[`E2E_${who}_EMAIL`] = email;
    process.env[`E2E_${who}_CREDENTIALS`] = JSON.stringify({
      email,
      keyHash: createHash('sha256').update(password).digest('hex'),
    });
  }
}
const port = process.env.E2E_PORT || '8799';
process.env.E2E_HOLDING_PORT ||= '8798';
process.env.E2E_HOLDING_KEY ||= 'kosw_' + randomBytes(32).toString('base64url');

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    locale: 'it-IT',
    timezoneId: 'Europe/Rome',
    // Fake microphone for the live inspection tests.
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: {
    command: 'node scripts/e2e-server.mjs',
    url: `http://localhost:${port}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
});

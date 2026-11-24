import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

const port = process.env.TEXTRELAY_E2E_PORT ?? '3000';
if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) {
  throw new Error('TEXTRELAY_E2E_PORT must be a valid TCP port');
}
const host = '127.0.0.1';
const baseURL = `http://${host}:${port}`;

function createRunDirectory() {
  const outputRoot = join(import.meta.dirname, 'test-results');
  mkdirSync(outputRoot, { recursive: true });
  return mkdtempSync(join(outputRoot, 'browser-'));
}

// Playwright reloads the configuration in worker processes.
const runDirectory = (process.env.TEXTRELAY_E2E_RUN_DIRECTORY ??= createRunDirectory());
const databasePath = join(runDirectory, 'acceptance.db');

export default defineConfig({
  testDir: './tests/browser',
  outputDir: join(runDirectory, 'artifacts'),
  workers: 1,
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['json', { outputFile: join(runDirectory, 'browser.json') }]],
  webServer: {
    command: 'npm run start',
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      HOST: host,
      PORT: port,
      APP_ORIGIN: baseURL,
      COOKIE_SECURE: 'false',
      DATABASE_PATH: databasePath,
      ATTACHMENT_DIR: join(runDirectory, 'attachments'),
      PUBLIC_READ_ENABLED: 'true',
      TRUSTED_PROXY: '',
    },
  },
});

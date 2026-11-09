import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['json', { outputFile: 'test-results/browser.json' }]],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      APP_ORIGIN: 'http://localhost:3000',
      COOKIE_SECURE: 'false',
      DATABASE_PATH: './data/acceptance.db',
    },
  },
});

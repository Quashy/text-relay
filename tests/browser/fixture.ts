import { join } from 'node:path';
import { openDb } from '../../src/server/db.js';

export function openBrowserDb() {
  const runDirectory = process.env.TEXTRELAY_E2E_RUN_DIRECTORY;
  if (!runDirectory) throw new Error('Playwright did not configure an isolated database');
  return openDb(join(runDirectory, 'acceptance.db'));
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const source = readFileSync('deploy/deploy.sh', 'utf8');
const handler = source
  .split('# BEGIN SCHEMA-SAFE FAILURE HANDLER\n')[1]
  .split('# END SCHEMA-SAFE FAILURE HANDLER')[0];
const bash =
  process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
    ? 'C:/Program Files/Git/bin/bash.exe'
    : 'bash';
for (const [name, before, after, queryFail, rollsBack] of [
  ['same schema', '1', '1', false, true],
  ['migration succeeded but app failed', '1', '2', false, false],
  ['schema query failed', '1', '', true, false],
  ['malformed schema', '1', 'noise', false, false],
  ['unknown original schema', '', '1', false, false],
] as const)
  test(`deployment failure: ${name}`, () => {
    const program = `set -euo pipefail
previous=text-relay:old
schema_before='${before}'
backup=/app/backups/test.db
schema_query=read-only-query
compose() { printf 'COMPOSE:%s\\n' "$*" >&2; if [[ "$1" == run ]]; then ${queryFail ? 'return 1' : `printf '%s\\n' '${after}'`}; fi; }
healthy() { echo HEALTH_CHECK >&2; }
${handler}
recover_failed_deployment
`;
    const result = spawnSync(bash, ['-s'], { input: program, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /COMPOSE:stop app/);
    assert.match(result.stderr, /run --rm --no-deps -T --entrypoint node app/);
    if (rollsBack) {
      assert.match(result.stderr, /COMPOSE:up -d --no-build --force-recreate app/);
      assert.match(result.stderr, /HEALTH_CHECK/);
    } else {
      assert.doesNotMatch(result.stderr, /COMPOSE:up /);
      assert.match(result.stderr, /Automatic image rollback blocked/);
      assert.match(result.stderr, /Database and backup preserved/);
    }
  });
test('first failed install does not invent a rollback image', () => {
  const program = `set -euo pipefail
previous=
schema_before=
backup=
schema_query=
compose(){ echo "COMPOSE:$*" >&2; }
${handler}
recover_failed_deployment`;
  const result = spawnSync(bash, ['-s'], { input: program, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /COMPOSE:stop app/);
  assert.doesNotMatch(result.stderr, /COMPOSE:up /);
});
test('production deploy wrapper passes bash syntax validation', () => {
  const result = spawnSync(bash, ['-n'], { input: source, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('failure to stop the app blocks all automated recovery', () => {
  const program = `set -euo pipefail
previous=text-relay:old
schema_before=1
backup=/app/backups/test.db
schema_query=read-only-query
compose(){ echo "COMPOSE:$*" >&2; return 1; }
${handler}
recover_failed_deployment`;
  const result = spawnSync(bash, ['-s'], { input: program, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Cannot confirm the failed app stopped/);
  assert.doesNotMatch(result.stderr, /COMPOSE:run |COMPOSE:up /);
});

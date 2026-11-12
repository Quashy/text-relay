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

const fetchRelease = source
  .split('# BEGIN VERIFIED SOURCE FETCH\n')[1]
  .split('# END VERIFIED SOURCE FETCH')[0];
for (const scenario of ['success', 'stale main', 'download failure', 'invalid archive'] as const) {
  test(`verified source archive: ${scenario}`, () => {
    const program = `set -euo pipefail
base=$(mktemp -d /tmp/textrelay-source-test.XXXXXX)
[[ "$base" == /tmp/textrelay-source-test.* ]]
trap 'rm -rf -- "$base"' EXIT
mkdir -p "$base/releases" "$base/fixture/text-relay-commit"
printf 'verified fixture' > "$base/fixture/text-relay-commit/verified.txt"
tar -czf "$base/fixture.tar.gz" -C "$base/fixture" text-relay-commit
sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
curl() {
  local url="\${!#}" output= arg
  if [[ "$url" == https://api.github.com/repos/Quashy/text-relay/git/ref/heads/main ]]; then
    printf '%s' '{"object":{"sha":"${scenario === 'stale main' ? 'b'.repeat(40) : 'a'.repeat(40)}"}}'
    return
  fi
  echo ARCHIVE_REQUEST >&2
  [[ "$url" == "https://codeload.github.com/Quashy/text-relay/tar.gz/$sha" ]] || return 24
  ${scenario === 'download failure' ? 'return 22' : ''}
  while (($#)); do
    if [[ "$1" == --output ]]; then output=$2; shift; fi
    shift
  done
  ${scenario === 'invalid archive' ? 'printf invalid > "$output"' : 'cp "$base/fixture.tar.gz" "$output"'}
}
${fetchRelease}
fetch_release
[[ $(cat "$release/verified.txt") == 'verified fixture' ]]
[[ -z $(find "$base/releases" -maxdepth 1 -name 'source-*.tar.gz' -print) ]]
echo VERIFIED_SOURCE_READY
`;
    const result = spawnSync(bash, ['-s'], { input: program, encoding: 'utf8' });
    assert.equal(
      result.status,
      scenario === 'success' ? 0 : scenario === 'stale main' ? 65 : 68,
      result.stderr,
    );
    if (scenario === 'success') assert.match(result.stdout, /VERIFIED_SOURCE_READY/);
    else assert.doesNotMatch(result.stdout, /VERIFIED_SOURCE_READY/);
    if (scenario === 'stale main') assert.doesNotMatch(result.stderr, /ARCHIVE_REQUEST/);
  });
}

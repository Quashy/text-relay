#!/usr/bin/env bash
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export HOME=/root
unset BASH_ENV ENV CDPATH GIT_DIR GIT_WORK_TREE DOCKER_HOST DOCKER_CONTEXT
[[ $# == 1 && $1 =~ ^[0-9a-f]{40}$ ]] || { echo "Expected one lowercase commit SHA" >&2; exit 64; }
sha=$1
base=/opt/text-relay
repo=$base/repo
exec 9>/run/lock/text-relay-deploy.lock
flock -w 900 9
cd "$base"
git -C "$repo" -c core.hooksPath=/dev/null fetch --no-tags https://github.com/Quashy/text-relay.git +refs/heads/main:refs/remotes/origin/main
[[ $(git -C "$repo" rev-parse refs/remotes/origin/main) == "$sha" ]] || { echo "Commit is no longer main" >&2; exit 65; }
release=$(mktemp -d "$base/releases/$sha.XXXXXX")
git -C "$repo" archive "$sha" | tar -x -C "$release"
build_args=()
if [[ -f "$base/build.env" ]]; then
  # Operator-owned shell configuration, never copied from the repository.
  [[ $(stat -c '%u:%a' "$base/build.env") =~ ^0:(600|640|644)$ ]] || exit 66
  source "$base/build.env"
  [[ ${NODE_IMAGE:-} =~ ^[a-zA-Z0-9./:@_-]+$ ]] || exit 66
  build_args+=(--build-arg "NODE_IMAGE=$NODE_IMAGE")
  if [[ -n ${NODE_BUILD_IMAGE:-} ]]; then
    [[ $NODE_BUILD_IMAGE =~ ^[a-zA-Z0-9./:@_-]+$ ]] || exit 66
    build_args+=(--build-arg "NODE_BUILD_IMAGE=$NODE_BUILD_IMAGE")
  fi
fi
export APP_VERSION="$sha"
compose() { docker compose --project-name text-relay --env-file "$base/.env" -f "$base/compose.yaml" "$@"; }
old=$(compose ps -q app)
previous=
schema_before=
backup=
schema_query='const D=require("better-sqlite3");const d=new D("/app/data/textrelay.db",{readonly:true,fileMustExist:true});console.log(d.prepare("SELECT max(version) AS v FROM schema_migrations").get().v);d.close();'
if [[ -n "$old" ]]; then
  previous=$(docker inspect --format '{{.Config.Image}}' "$old")
  docker image tag "$previous" text-relay:rollback
fi
docker build "${build_args[@]}" --tag "text-relay:$sha" "$release"
if [[ -n "$old" ]]; then
  schema_before=$(compose exec -T app node -e "$schema_query")
  [[ "$schema_before" =~ ^[0-9]+$ ]] || { echo "Cannot verify pre-deploy schema" >&2; exit 67; }
  backup="/app/backups/pre-deploy-$sha-$(date -u +%Y%m%dT%H%M%S)-$$.db"
  compose exec -T app node dist/server/cli.js backup "$backup"
fi
healthy() {
  for ((i=0; i<30; i++)); do
    if curl --fail --silent --max-time 3 -H 'Host: 1.14.186.80' http://127.0.0.1:18080/api/health >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
# BEGIN SCHEMA-SAFE FAILURE HANDLER
recover_failed_deployment() {
  echo "Deployment failed; stopping the failed app before checking schema" >&2
  if ! compose stop app; then
    echo "Cannot confirm the failed app stopped; automatic rollback blocked. Operator attention required." >&2
    return 1
  fi
  if [[ -n "$previous" ]]; then
    local schema_after
    # Read the volume with the checked image, without starting the application or migrating it.
    if ! schema_after=$(compose run --rm --no-deps -T --entrypoint node app -e "$schema_query"); then
      schema_after=unknown
    fi
    if [[ "$schema_before" =~ ^[0-9]+$ && "$schema_after" == "$schema_before" ]]; then
      export APP_VERSION=rollback
      compose up -d --no-build --force-recreate app
      healthy || echo "Rollback health check failed; operator attention required" >&2
    else
      echo "Automatic image rollback blocked: schema $schema_before -> $schema_after" >&2
      echo "Database and backup preserved. Keep the app stopped; deploy a compatible fix or restore a matched database/image pair after saving post-migration data." >&2
      echo "Pre-deploy backup: $backup" >&2
    fi
  fi
  return 1
}
# END SCHEMA-SAFE FAILURE HANDLER
if compose up -d --no-build --force-recreate app && healthy; then
  printf '%s\n' "$sha" > "$base/deployed-sha"
  echo "Deployed $sha"
else
  recover_failed_deployment
fi

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
fi
docker build "${build_args[@]}" --tag "text-relay:$sha" "$release"
export APP_VERSION="$sha"
compose() { docker compose --project-name text-relay --env-file "$base/.env" -f "$base/compose.yaml" "$@"; }
old=$(compose ps -q app)
previous=
if [[ -n "$old" ]]; then
  previous=$(docker inspect --format '{{.Image}}' "$old")
  docker image tag "$previous" text-relay:rollback
  compose exec -T app node dist/server/cli.js backup "/app/backups/pre-deploy-$sha-$(date -u +%Y%m%dT%H%M%S)-$$.db"
fi
healthy() {
  for ((i=0; i<30; i++)); do
    if curl --fail --silent --max-time 3 -H 'Host: 1.14.186.80' http://127.0.0.1:18080/api/health >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
if compose up -d --no-build --force-recreate app && healthy; then
  printf '%s\n' "$sha" > "$base/deployed-sha"
  echo "Deployed $sha"
else
  echo "Deployment failed; attempting image rollback" >&2
  if [[ -n "$previous" ]]; then
    export APP_VERSION=rollback
    compose up -d --no-build --force-recreate app
    healthy || echo "Rollback health check failed; operator attention required" >&2
  else
    compose stop app
  fi
  exit 1
fi
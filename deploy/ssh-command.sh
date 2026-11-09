#!/usr/bin/env bash
set -euo pipefail
# Install root-owned; authorized_keys invokes this without arguments.
[[ ${SSH_ORIGINAL_COMMAND:-} =~ ^[0-9a-f]{40}$ ]] || exit 64
exec sudo -n /usr/local/sbin/textrelay-deploy "$SSH_ORIGINAL_COMMAND"
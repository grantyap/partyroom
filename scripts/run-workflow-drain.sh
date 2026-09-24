#!/bin/bash
set -euo pipefail

credentials=/convex/data/credentials
export CONVEX_SELF_HOSTED_URL=http://backend:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY
CONVEX_SELF_HOSTED_ADMIN_KEY=$(generate_key "$(<"$credentials/instance_name")" "$(<"$credentials/instance_secret")")

cd /workspace
exec bun scripts/workflow-drain.ts "$@"

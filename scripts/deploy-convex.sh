#!/bin/bash
set -euo pipefail

: "${SITE_URL:?}"
: "${BETTER_AUTH_SECRET:?}"
: "${ACTIVITY_WORKER_TOKEN:?}"
: "${WORKER_SIGNING_SECRET:?}"

credentials=/convex/data/credentials
export CONVEX_SELF_HOSTED_URL=http://backend:3210
export CONVEX_SELF_HOSTED_ADMIN_KEY
CONVEX_SELF_HOSTED_ADMIN_KEY=$(generate_key "$(<"$credentials/instance_name")" "$(<"$credentials/instance_secret")")

bunx convex env set SITE_URL "$SITE_URL"
bunx convex env set BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
bunx convex env set ACTIVITY_WORKER_TOKEN "$ACTIVITY_WORKER_TOKEN"
bunx convex env set WORKER_SIGNING_SECRET "$WORKER_SIGNING_SECRET"
bunx convex env set WORKER_CONVEX_CLOUD_ORIGIN http://backend:3210
bunx convex deploy --typecheck disable

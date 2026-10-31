#!/usr/bin/env bash
# Creates accounts on the production server from stdin lines: "<phone-or-email> <password>".
# Accounts created here do not have to change the password on first login.
# Passwords travel over the SSH session's stdin only, never in command lines.
# Usage: printf '%s %s\n' 13800000000 123456 | bash server/deploy/create-users.sh
set -euo pipefail
deploy_server=${REVIEW_DEPLOY_SERVER:-root@118.31.44.140}
identity=${REVIEW_DEPLOY_IDENTITY:-$HOME/.ssh/id_rsa}
{
  cat <<'REMOTE'
set -euo pipefail
set -a; . /etc/review-api.env; set +a
while read -r id pw; do
  [[ -n "$id" ]] || continue
  if REVIEW_BOOTSTRAP_IDENTIFIER="$id" REVIEW_BOOTSTRAP_PASSWORD="$pw" REVIEW_BOOTSTRAP_MUST_CHANGE=0 \
    /opt/review-api/review-api create-user; then
    echo "created: $id"
  else
    echo "failed: $id" >&2
  fi
done <<'USERS'
REMOTE
  # Runs as root; hand the database files back to the service user afterwards.
  trailer='chown review-api:review-api "${REVIEW_DB:-/var/lib/review-api/review.db}"*' 
  cat
  echo USERS
  echo "$trailer"
} | ssh -i "$identity" -o IdentitiesOnly=yes -o BatchMode=yes "$deploy_server" bash

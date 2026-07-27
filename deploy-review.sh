#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DIR="${LOCAL_DIR:-$ROOT_DIR/web}"
API_DIR="${API_DIR:-$ROOT_DIR/sync_api}"
NGINX_CONF="${NGINX_CONF:-$ROOT_DIR/deploy/nginx/review.studynote.me.conf}"
SYSTEMD_SERVICE="${SYSTEMD_SERVICE:-$ROOT_DIR/deploy/systemd/review-sync.service}"
SERVER="${SERVER:-root@118.31.44.140}"
IDENTITY_FILE="${IDENTITY_FILE:-$HOME/.ssh/id_rsa}"
REMOTE_DIR="${REMOTE_DIR:-/data/webroot/review}"
REMOTE_OWNER="${REMOTE_OWNER:-www-data:www-data}"
REMOTE_API_DIR="${REMOTE_API_DIR:-/data/review-sync/app}"
REMOTE_DATA_DIR="${REMOTE_DATA_DIR:-/data/review-sync/data}"

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "Local directory not found: $LOCAL_DIR" >&2
  exit 1
fi
if [[ ! -d "$API_DIR" ]]; then
  echo "API directory not found: $API_DIR" >&2
  exit 1
fi
if [[ ! -f "$NGINX_CONF" || ! -f "$SYSTEMD_SERVICE" ]]; then
  echo "Deploy config files are missing." >&2
  exit 1
fi

ssh_opts=(
  -i "$IDENTITY_FILE"
  -o IdentitiesOnly=yes
  -o BatchMode=yes
)

echo "Deploying $LOCAL_DIR to $SERVER:$REMOTE_DIR"

COPYFILE_DISABLE=1 tar \
  --no-xattrs \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='__pycache__' \
  -C "$LOCAL_DIR" \
  -czf - . | ssh "${ssh_opts[@]}" "$SERVER" "
    set -e
    rm -rf '$REMOTE_DIR'
    mkdir -p '$REMOTE_DIR'
    tar -xzf - -C '$REMOTE_DIR'
    chown -R '$REMOTE_OWNER' '$REMOTE_DIR'
    nginx -t
    systemctl reload nginx
  "

echo "Deploying sync API to $SERVER:$REMOTE_API_DIR"

COPYFILE_DISABLE=1 tar \
  --no-xattrs \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='__pycache__' \
  -C "$API_DIR" \
  -czf - . | ssh "${ssh_opts[@]}" "$SERVER" "
    set -e
    mkdir -p '$REMOTE_API_DIR' '$REMOTE_DATA_DIR'
    tar -xzf - -C '$REMOTE_API_DIR'
    chown -R '$REMOTE_OWNER' /data/review-sync
    chmod 750 /data/review-sync '$REMOTE_API_DIR' '$REMOTE_DATA_DIR'
  "

scp "${ssh_opts[@]}" "$SYSTEMD_SERVICE" "$SERVER:/etc/systemd/system/review-sync.service"
scp "${ssh_opts[@]}" "$NGINX_CONF" "$SERVER:/etc/nginx/conf.d/review.studynote.me.conf"

ssh "${ssh_opts[@]}" "$SERVER" "
  set -e
  systemctl daemon-reload
  systemctl enable --now review-sync
  systemctl restart review-sync
  nginx -t
  systemctl reload nginx
  systemctl --no-pager --full status review-sync | sed -n '1,12p'
"

echo "Deploy complete: https://review.studynote.me"

#!/usr/bin/env bash
# Receives an uploaded release folder. Installs only the new API and an additive nginx route.
set -euo pipefail
release_dir=$1
nginx_conf=/etc/nginx/conf.d/review.studynote.me.conf
release_stamp=$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 0755 /opt/review-api /opt/review-api/releases
if ! id review-api >/dev/null 2>&1; then useradd --system --home /var/lib/review-api --shell /usr/sbin/nologin review-api; fi
install -d -m 0700 -o review-api -g review-api /var/lib/review-api /var/backups/review-api
if [[ ! -f /etc/review-api.env ]]; then
  umask 077
  { echo 'REVIEW_ADDR=127.0.0.1:3108'; echo 'REVIEW_DB=/var/lib/review-api/review.db'; printf 'REVIEW_CODE_SECRET='; openssl rand -hex 32; } > /etc/review-api.env
  chown root:review-api /etc/review-api.env
  chmod 0640 /etc/review-api.env
fi
# Preserve the current database and binary before any migration or replacement.
if [[ -x /opt/review-api/review-api ]]; then
  cp -p /opt/review-api/review-api "/opt/review-api/releases/review-api-$release_stamp"
  if [[ -f /var/lib/review-api/review.db ]]; then systemctl start review-api-backup.service; fi
fi
install -m 0755 "$release_dir/review-api" /opt/review-api/review-api.next
mv /opt/review-api/review-api.next /opt/review-api/review-api
install -m 0755 "$release_dir/backup.sh" /opt/review-api/backup.sh
install -m 0644 "$release_dir/review-api.service" "$release_dir/review-api-backup.service" "$release_dir/review-api-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable review-api
systemctl restart review-api
healthy=0
for attempt in $(seq 1 15); do
  if curl --fail --silent http://127.0.0.1:3108/healthz >/dev/null; then healthy=1; break; fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  if [[ -f "/opt/review-api/releases/review-api-$release_stamp" ]]; then
    cp -p "/opt/review-api/releases/review-api-$release_stamp" /opt/review-api/review-api
    systemctl restart review-api
  else systemctl stop review-api; fi
  echo 'API health check failed; previous binary restored when available' >&2
  exit 1
fi
cp -p "$nginx_conf" "/opt/review-api/releases/nginx-$release_stamp.conf"
python3 - "$nginx_conf" <<'PY'
import sys
from pathlib import Path
path=Path(sys.argv[1]);text=path.read_text()
if 'location /api/v1/' not in text:
    needle='    location /api/sync/ {'
    if text.count(needle)!=1: raise SystemExit('Unexpected nginx config: add route manually after inspection')
    text=text.replace(needle,'''    location /api/v1/ {
        client_max_body_size 256k;
        proxy_pass http://127.0.0.1:3108;
        proxy_connect_timeout 5s;
        proxy_read_timeout 35s;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        # API access logs omit query parameters, request bodies and credentials.
        access_log off;
    }

'''+needle)
    path.write_text(text)
PY
if nginx -t; then systemctl reload nginx; else
  cp -p "/opt/review-api/releases/nginx-$release_stamp.conf" "$nginx_conf"
  echo 'nginx validation failed; config restored' >&2
  exit 1
fi
systemctl enable --now review-api-backup.timer
systemctl start review-api-backup.service
curl --fail --silent https://review.studynote.me/api/v1/auth/capabilities
systemctl is-active review-api nginx review-sync review-api-backup.timer

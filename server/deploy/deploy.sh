#!/usr/bin/env bash
set -euo pipefail
project_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
deploy_server=${REVIEW_DEPLOY_SERVER:-root@118.31.44.140}
identity=${REVIEW_DEPLOY_IDENTITY:-$HOME/.ssh/id_rsa}
release_dir=$(mktemp -d)
trap 'rm -rf "$release_dir"' EXIT
(cd "$project_dir" && go test ./... && go vet ./... && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o "$release_dir/review-api" ./cmd/review-api)
cp "$project_dir"/deploy/{install-remote.sh,backup.sh,review-api.service,review-api-backup.service,review-api-backup.timer} "$release_dir/"
ssh_args=(-i "$identity" -o IdentitiesOnly=yes -o BatchMode=yes)
remote_dir=$(ssh "${ssh_args[@]}" "$deploy_server" 'mktemp -d /tmp/review-api-release.XXXXXXXX')
scp "${ssh_args[@]}" "$release_dir"/* "$deploy_server:$remote_dir/"
ssh "${ssh_args[@]}" "$deploy_server" bash "$remote_dir/install-remote.sh" "$remote_dir"

#!/bin/sh
set -eu
umask 077
backup_dir=/var/backups/review-api
snapshot="$backup_dir/review-$(date -u +%Y%m%dT%H%M%SZ).db"
/opt/review-api/review-api backup "$snapshot"
# Retain 30 days only after a new consistent backup has succeeded.
find "$backup_dir" -maxdepth 1 -type f -name 'review-*.db' -mtime +30 -delete

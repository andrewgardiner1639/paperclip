#!/bin/sh
set -eu
cd /opt/paperclip
backup_dir=/opt/paperclip/backups
install -d -m 700 "$backup_dir"
timestamp=$(date -u +%Y%m%d-%H%M%S)
umask 077
partial="$backup_dir/database-$timestamp.sql.partial"
docker compose exec -T db pg_dump -U paperclip -d paperclip > "$partial"
gzip "$partial"
mv "$partial.gz" "$backup_dir/database-$timestamp.sql.gz"
# Remove only completed database backup files from this designated directory.
find "$backup_dir" -maxdepth 1 -type f -name 'database-*.sql.gz' -mtime +14 -delete

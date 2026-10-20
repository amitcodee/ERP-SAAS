#!/bin/sh
# Proves the newest database backup can actually be restored (DEPLOY.md §6). Run ON THE SERVER as root:
#
#   sh backup-restore-check.sh                         # newest file under /data/coolify/backups, auto-detected container
#   sh backup-restore-check.sh /path/to/backup.dmp techcadd-container-name
#
# It restores into a throw-away database (restore_check) inside the same PostgreSQL container, compares row
# counts and the migration level with the live database, then drops the copy. The live database is only read.
# Exit code 0 = restore proven; anything else = do not trust the backups until fixed.
set -eu

LIVE_DB="${LIVE_DB:-techcadd_panel}"
SCRATCH=restore_check
FILE="${1:-$(find /data/coolify/backups -type f \( -name '*.dmp' -o -name '*.sql' -o -name '*.gz' \) -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)}"
CONTAINER="${2:-$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /postgres/ {print $1}' | head -1)}"

[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "FAIL: no backup file found (pass its path as the first argument)"; exit 2; }
[ -n "$CONTAINER" ] || { echo "FAIL: no PostgreSQL container found (pass its name as the second argument)"; exit 2; }
AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$FILE") ) / 3600 ))
echo "backup:    $FILE ($(du -h "$FILE" | cut -f1), ${AGE_H}h old)"
echo "container: $CONTAINER   live db: $LIVE_DB"
[ "$AGE_H" -le 30 ] || echo "WARN: newest backup is older than 30 hours - is the daily backup still running?"

USER_ARG="-U ${POSTGRES_USER:-postgres}"
psql_in() { docker exec -i "$CONTAINER" psql $USER_ARG -v ON_ERROR_STOP=1 -qAt "$@"; }

psql_in -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
trap 'psql_in -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true' EXIT

# Coolify writes pg_dump custom format; plain and gzipped SQL are handled too.
if head -c 5 "$FILE" | grep -q PGDMP; then
  docker exec -i "$CONTAINER" pg_restore $USER_ARG -d "$SCRATCH" --no-owner --exit-on-error < "$FILE"
elif gzip -t "$FILE" 2>/dev/null; then
  gunzip -c "$FILE" | psql_in -d "$SCRATCH" >/dev/null
else
  psql_in -d "$SCRATCH" < "$FILE" >/dev/null
fi
echo "restore:   OK"

COUNTS="select string_agg(t || '=' || n, ' ' order by t) from (
  select 'branches' t, count(*) n from branches union all select 'users', count(*) from users
  union all select 'persons', count(*) from persons union all select 'enquiries', count(*) from enquiries
  union all select 'registrations', count(*) from registrations union all select 'payments', count(*) from payments
  union all select 'receipts', count(*) from receipts union all select 'fee_ledger', count(*) from fee_ledger
  union all select 'certificates', count(*) from certificates union all select 'audit_logs', count(*) from audit_logs) x"
MIG="select count(*) from drizzle.__drizzle_migrations"
MONEY="select coalesce(sum(amount),0) from fee_ledger"

R_COUNTS=$(psql_in -d "$SCRATCH" -c "$COUNTS"); L_COUNTS=$(psql_in -d "$LIVE_DB" -c "$COUNTS")
R_MIG=$(psql_in -d "$SCRATCH" -c "$MIG");       L_MIG=$(psql_in -d "$LIVE_DB" -c "$MIG")
R_MONEY=$(psql_in -d "$SCRATCH" -c "$MONEY")
echo "restored:  $R_COUNTS  migrations=$R_MIG  ledger-sum=$R_MONEY"
echo "live now:  $L_COUNTS  migrations=$L_MIG"

FAIL=0
[ "$R_MIG" -gt 0 ] || { echo "FAIL: restored copy has no migrations table rows"; FAIL=1; }
[ "$R_MIG" -le "$L_MIG" ] || { echo "FAIL: restored copy is NEWER than live?"; FAIL=1; }
[ "$R_MIG" -eq "$L_MIG" ] || echo "WARN: a migration ran after this backup ($R_MIG vs $L_MIG) - normal right after a deploy"
echo "$R_COUNTS" | grep -q 'users=0' && { echo "FAIL: restored copy has no users"; FAIL=1; }
# Append-only tables can only grow: the copy must never hold MORE rows than live.
for t in receipts fee_ledger audit_logs payments; do
  r=$(echo "$R_COUNTS" | tr ' ' '\n' | grep "^$t=" | cut -d= -f2); l=$(echo "$L_COUNTS" | tr ' ' '\n' | grep "^$t=" | cut -d= -f2)
  [ "$r" -le "$l" ] || { echo "FAIL: $t has $r rows in the backup but $l live"; FAIL=1; }
done
[ "$FAIL" -eq 0 ] && echo "RESULT: backup restored and checked - OK" || echo "RESULT: FAILED"
exit "$FAIL"

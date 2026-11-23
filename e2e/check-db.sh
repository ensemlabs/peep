#!/bin/sh
# A3 (DB part): every stored password hash is argon2id, and at least one user exists.
# Usage: check-db.sh <docker compose command...>   (e.g. docker compose -f docker-compose.yml ...)
set -eu
QUERY_BAD="select count(*) from users where password_hash not like (chr(36) || 'argon2id' || chr(36) || '%')"
QUERY_ALL="select count(*) from users"
bad=$(echo "$QUERY_BAD" | "$@" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' | tr -d '[:space:]')
all=$(echo "$QUERY_ALL" | "$@" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' | tr -d '[:space:]')
echo "A3 db check: users=$all non-argon2id=$bad"
[ "$bad" = "0" ] && [ "${all:-0}" -ge 1 ]

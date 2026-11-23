#!/bin/sh
# DB checks run after the suite:
#  - A3: every stored password hash is argon2id, and at least one user exists.
#  - A13: no plugin header value is stored in plaintext (the secrets used by the A13 specs must not appear).
# Usage: check-db.sh <docker compose command...>   (e.g. docker compose -f docker-compose.yml ...)
set -eu
q() { # q "<sql>" -> number
  sql=$1; shift
  echo "$sql" | "$@" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA' | tr -d '[:space:]'
}
bad=$(q "select count(*) from users where password_hash not like (chr(36) || 'argon2id' || chr(36) || '%')" "$@")
all=$(q "select count(*) from users" "$@")
leaked=$(q "select count(*) from plugins where headers::text like '%test-secret-123%' or headers::text like '%import-secret-456%'" "$@")
plugins=$(q "select count(*) from plugins" "$@")
echo "A3 db check: users=$all non-argon2id=$bad"
echo "A13 db check: plugins=$plugins with plaintext secret=$leaked"
[ "$bad" = "0" ] && [ "${all:-0}" -ge 1 ] && [ "$leaked" = "0" ]

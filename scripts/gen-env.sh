#!/bin/sh
# Create .env from .env.example with fresh random secrets in place of every "change-me" placeholder.
# Never overwrites an existing .env. Prints where the values are, never the values.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  exit 0
fi

rand() { # rand <length>: alphanumeric, from the kernel CSPRNG
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" || true
}

pg=$(rand 32)
minio_user=peep$(rand 12)
minio_pass=$(rand 40)
admin=$(rand 24)
# Fernet key: 32 random bytes, url-safe base64 (44 chars).
fernet=$(head -c 32 /dev/urandom | base64 | tr -d '\n' | tr '+/' '-_')

tmp=$(mktemp .env.XXXXXX)
trap 'rm -f "$tmp"' EXIT INT TERM
chmod 600 "$tmp"
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pg|" \
  -e "s|^\(DATABASE_URL=[^:]*://[^:]*:\)[^@]*@|\1$pg@|" \
  -e "s|^MINIO_ROOT_USER=.*|MINIO_ROOT_USER=$minio_user|" \
  -e "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$minio_user|" \
  -e "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$minio_pass|" \
  -e "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$minio_pass|" \
  -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$admin|" \
  -e "s|^SECRETS_KEY=.*|SECRETS_KEY=$fernet|" \
  .env.example >"$tmp"

if grep -v '^[[:space:]]*#' "$tmp" | grep -q 'change-me'; then
  echo "gen-env: a change-me placeholder is left in .env.example; not creating .env" >&2
  exit 1
fi
mv "$tmp" .env
echo "created .env with generated secrets (postgres, minio, SECRETS_KEY, admin password)"
echo "admin login: see ADMIN_EMAIL / ADMIN_PASSWORD in .env"

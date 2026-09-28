#!/usr/bin/env bash
# Sobe PostgREST LOCAL (127.0.0.1:55501) apontando só para o clone descartável adm-mt-clone.
# Segredo JWT efêmero gerado a cada execução, gravado fora do repo (TMPDIR). Nunca fala com banco remoto.
# Uso: bash local-rest.sh up|down
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME=adm-mt-rest
STATE="${TMPDIR:-/tmp}/adm-mt-rest"
case "${1:-up}" in
  down) docker rm -f "$NAME" > /dev/null 2>&1 || true; rm -rf "$STATE"; exit 0 ;;
  up) ;;
  *) printf 'uso: local-rest.sh up|down\n' >&2; exit 2 ;;
esac
[[ "$(docker inspect -f '{{.State.Running}}' adm-mt-clone 2>/dev/null)" == "true" ]] || { printf 'clone local adm-mt-clone parado\n' >&2; exit 1; }
mkdir -p "$STATE"; chmod 700 "$STATE"
node "$HERE/tests/local-jwt.mjs" secret > "$STATE/secret"
{
  printf 'PGRST_DB_URI=postgres://authenticator:localtest@127.0.0.1:55500/postgres\n'
  printf 'PGRST_DB_SCHEMAS=public\n'
  printf 'PGRST_DB_ANON_ROLE=anon\n'
  printf 'PGRST_JWT_SECRET=%s\n' "$(cat "$STATE/secret")"
  printf 'PGRST_SERVER_HOST=127.0.0.1\n'
  printf 'PGRST_SERVER_PORT=55501\n'
} > "$STATE/env"
bash "$HERE/lpsql.sh" -c "ALTER ROLE authenticator WITH LOGIN PASSWORD 'localtest'" > /dev/null
docker rm -f "$NAME" > /dev/null 2>&1 || true
docker run -d --name "$NAME" --network host --env-file "$STATE/env" postgrest/postgrest:v12.2.3 > /dev/null
for _ in $(seq 1 30); do
  curl -fs -o /dev/null "http://127.0.0.1:55501/" -H "Authorization: Bearer $(node "$HERE/tests/local-jwt.mjs" token "$STATE/secret" service_role)" && break
  sleep 1
done
node "$HERE/tests/local-jwt.mjs" token "$STATE/secret" service_role > "$STATE/service_token"
printf 'PostgREST local em http://127.0.0.1:55501 (estado em %s)\n' "$STATE"

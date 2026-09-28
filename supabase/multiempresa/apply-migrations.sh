#!/usr/bin/env bash
# Recria um Postgres descartável (container Docker supabase/postgres, só em 127.0.0.1) e aplica
# todas as migrations locais em ordem.
# Uso: bash supabase/multiempresa/apply-migrations.sh [ate_versao]
# RESET=0 reaproveita o container atual (não recria).
# NUNCA aponte para banco remoto: o script só fala com `docker exec` no container local.
set -euo pipefail
CONTAINER="${CONTAINER:-adm-mt-fase1}"
PORT="${PORT:-55499}"
IMAGE="${IMAGE:-supabase/postgres:15.8.1.085}"
UNTIL="${1:-99999999999999}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ERR="${TMPDIR:-/tmp}/adm_mig_err.txt"
PSQL=(docker exec -i -e PGPASSWORD=localtest "$CONTAINER" psql -h 127.0.0.1 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q -X)

if [[ "${RESET:-1}" == "1" ]]; then
  docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=localtest -p "127.0.0.1:$PORT:5432" "$IMAGE" > /dev/null
  for _ in $(seq 1 90); do
    if docker exec "$CONTAINER" pg_isready -U postgres -h 127.0.0.1 > /dev/null 2>&1 \
      && docker exec "$CONTAINER" psql -U postgres -h 127.0.0.1 -Atc "select 1 from pg_roles where rolname='service_role'" 2>/dev/null | grep -q 1; then break; fi
    sleep 1
  done
  sleep 2
fi
"${PSQL[@]}" < "$ROOT/supabase/multiempresa/bootstrap.sql"

n=0; skipped=0
# Migrations que só corrigem registros reais de produção (abortam de propósito sem esses dados).
SKIP_FILE="$ROOT/supabase/multiempresa/skip-data-only-migrations.txt"
for f in "$ROOT"/supabase/migrations/*.sql; do
  v="$(basename "$f" | cut -d_ -f1)"
  [[ "$v" > "$UNTIL" ]] && break
  if grep -qx "$(basename "$f")" "$SKIP_FILE" 2>/dev/null; then skipped=$((skipped+1)); continue; fi
  if ! "${PSQL[@]}" -1 < "$f" > /dev/null 2> "$ERR"; then
    echo "FALHOU: $(basename "$f")"; cat "$ERR"; exit 1
  fi
  n=$((n+1))
done
echo "OK: $n migrations aplicadas; $skipped puladas (somente dados de produção)"

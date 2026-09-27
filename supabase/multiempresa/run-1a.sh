#!/usr/bin/env bash
# Ensaio completo do marco 1a em Postgres LOCAL descartável (docker, 127.0.0.1). Nunca fala com banco remoto.
# Uso: CATALOG_DIR=/caminho/privado/catalog bash supabase/multiempresa/run-1a.sh
#  1. recria container limpo (PG 17, mesma versão do ADM implantado)
#  2. clone estrutural a partir do catálogo (fora do repo) + fingerprint FP0
#  3. seed sintético do legado -> migration 1a (upgrade) -> testes A↔B (em transação, ROLLBACK)
#  4. rollback (down) -> fingerprint FP2 deve ser igual a FP0; dados legados preservados
#  5. reaplica a migration (idempotência do ciclo up/down/up) e roda os testes de novo
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CATALOG_DIR="${CATALOG_DIR:?defina CATALOG_DIR com o catálogo extraído (fora do repo)}"
export CONTAINER="${CONTAINER:-adm-mt-clone}"
PORT="${PORT:-55500}"
IMAGE="${IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.165}"
TMP="${TMPDIR:-/tmp}/mt1a.$$"; mkdir -p "$TMP"
PSQL=(bash "$HERE/lpsql.sh")
MIG="$HERE/migrations/20260928000000_mt_fase1a_fundacao.sql"
DOWN="$HERE/migrations/20260928000000_mt_fase1a_fundacao.down.sql"

docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=localtest -p "127.0.0.1:$PORT:5432" "$IMAGE" > /dev/null
for _ in $(seq 1 120); do
  docker exec "$CONTAINER" psql -U postgres -h 127.0.0.1 -Atc "select 1 from pg_roles where rolname='service_role'" 2>/dev/null | grep -q 1 && break
  sleep 1
done
sleep 3

python3 "$HERE/build_clone.py" "$CATALOG_DIR" > "$TMP/clone.sql"
"${PSQL[@]}" < "$HERE/clone-bootstrap.sql" 2> /dev/null
"${PSQL[@]}" -1 < "$TMP/clone.sql"
echo "clone: $("${PSQL[@]}" -At -F' ' < "$HERE/verify_clone.sql" | tr '\n' ';')"
FP0="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"

"${PSQL[@]}" < "$HERE/tests/seed_legacy.sql"
LEGACY0="$("${PSQL[@]}" -At -c "select string_agg(t||'='||n, ',' order by t) from (select 'profiles' t, count(*) n from profiles union all select 'sales', count(*) from sales union all select 'clientes', count(*) from clientes union all select 'rooms', count(*) from room_reservations union all select 'roles', count(*) from user_roles) s")"

"${PSQL[@]}" < "$MIG"
"${PSQL[@]}" -At -c "select 'backfill_sem_org=' || (select count(*) from sales where organization_id is null) + (select count(*) from profiles where organization_id is null)"
"${PSQL[@]}" -At < "$HERE/tests/isolation_1a.sql" | tail -1

"${PSQL[@]}" < "$DOWN"
FP2="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
LEGACY2="$("${PSQL[@]}" -At -c "select string_agg(t||'='||n, ',' order by t) from (select 'profiles' t, count(*) n from profiles union all select 'sales', count(*) from sales union all select 'clientes', count(*) from clientes union all select 'rooms', count(*) from room_reservations union all select 'roles', count(*) from user_roles) s")"
[[ "$FP0" == "$FP2" ]] && echo "rollback: schema identico ao original ($FP0)" || { echo "rollback: SCHEMA DIFERENTE $FP0 vs $FP2"; exit 1; }
[[ "$LEGACY0" == "$LEGACY2" ]] && echo "rollback: dados legados preservados ($LEGACY2)" || { echo "rollback: DADOS DIFERENTES $LEGACY0 vs $LEGACY2"; exit 1; }

"${PSQL[@]}" < "$MIG"
"${PSQL[@]}" -At < "$HERE/tests/isolation_1a.sql" | tail -1
echo "reaplicacao apos rollback: OK"
rm -rf "$TMP"

#!/usr/bin/env bash
# Ensaio local da migration 20260929090000 (excluir/cancelar venda) em Postgres DESCARTÁVEL
# (docker, só 127.0.0.1). Nunca fala com banco remoto.
# Uso: CATALOG_DIR=/caminho/privado/catalog MT_DIR=/caminho/supabase/multiempresa bash supabase/tests/run-excluir-cancelar.sh
#  1. clone estrutural a partir do catálogo de produção (fora do repo) + fingerprint FP0
#  2. suíte ANTES da migration (deve falhar) -> up -> suíte (deve passar)
#  3. rollback literal -> FP2 == FP0 -> up de novo -> suíte (idempotência do ciclo)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CATALOG_DIR="${CATALOG_DIR:?defina CATALOG_DIR}"
MT_DIR="${MT_DIR:?defina MT_DIR (supabase/multiempresa com build_clone.py)}"
export CONTAINER="${CONTAINER:-adm-ecv}"
PORT="${PORT:-55520}"
IMAGE="${IMAGE:-public.ecr.aws/supabase/postgres:17.6.1.165}"
TMP="${TMPDIR:-/tmp}/ecv.$$"; mkdir -p "$TMP"
PSQL=(docker exec -i -e PGPASSWORD=localtest "$CONTAINER" psql -h 127.0.0.1 -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres)
UP="$ROOT/supabase/migrations/20260929090000_excluir_cancelar_venda.sql"
DOWN="$ROOT/docs/sql/rollback/20260929090000_excluir_cancelar_venda.rollback.sql"
SUITE="$HERE/excluir_cancelar_venda.sql"

docker rm -f "$CONTAINER" > /dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=localtest -p "127.0.0.1:$PORT:5432" "$IMAGE" > /dev/null
for _ in $(seq 1 120); do
  docker exec "$CONTAINER" psql -U postgres -h 127.0.0.1 -Atc "select 1 from pg_roles where rolname='service_role'" 2>/dev/null | grep -q 1 && break
  sleep 1
done
sleep 3
python3 "$MT_DIR/build_clone.py" "$CATALOG_DIR" > "$TMP/clone.sql"
"${PSQL[@]}" < "$MT_DIR/clone-bootstrap.sql" 2> /dev/null
"${PSQL[@]}" -1 < "$TMP/clone.sql"
FP0="$("${PSQL[@]}" -At < "$MT_DIR/fingerprint.sql")"

# Antes da migration a suíte deve reprovar (regra antiga): mostra o total e quantas falhas.
"${PSQL[@]}" -At < "$SUITE" > "$TMP/antes.txt" 2>&1 || true
echo "[antes] $(grep -E '^TOTAL=' "$TMP/antes.txt" || grep -m1 -oE 'ERROR:.*' "$TMP/antes.txt") falhas=$(grep -c '^FALHA' "$TMP/antes.txt")"
grep '^FALHA' "$TMP/antes.txt" | sed -E 's/ -> .*//' | sort | uniq -c | sort -rn | head -8 | sed 's/^/[antes] /'

"${PSQL[@]}" < "$UP"
"${PSQL[@]}" -At < "$SUITE" | grep -E '^(TOTAL=|FALHA)' | sed 's/^/[up 1] /'

"${PSQL[@]}" < "$DOWN"
FP2="$("${PSQL[@]}" -At < "$MT_DIR/fingerprint.sql")"
[[ "$FP0" == "$FP2" ]] && echo "rollback: schema idêntico ao original (${FP0:0:12})" \
  || { echo "rollback: SCHEMA DIFERENTE $FP0 vs $FP2"; exit 1; }

"${PSQL[@]}" < "$UP"
"${PSQL[@]}" -At < "$SUITE" | grep -E '^(TOTAL=|FALHA)' | sed 's/^/[up 2] /'
rm -rf "$TMP"
docker rm -f "$CONTAINER" > /dev/null
echo "ensaio concluído; container $CONTAINER removido"

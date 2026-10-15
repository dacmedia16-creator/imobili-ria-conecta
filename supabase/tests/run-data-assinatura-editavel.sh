#!/usr/bin/env bash
# Ensaio da migration 20261015150000 (data de assinatura editável) numa ÚNICA transação revertida
# (banco local/teste, nunca produção): up -> suíte -> rollback -> checagem -> ROLLBACK.
# Uso: PGCONN="<conninfo local>" bash supabase/tests/run-data-assinatura-editavel.sh
#  ou: PSQL="docker exec -i adm-mural psql -U postgres -d postgres" bash supabase/tests/run-data-assinatura-editavel.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
UP="$ROOT/supabase/migrations/20261015150000_exclusividade_data_assinatura_editavel.sql"
DOWN="$ROOT/supabase/rollback/20261015150000_exclusividade_data_assinatura_editavel.sql"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
{
  echo "BEGIN;"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$UP"
  echo "\\echo [up ok]"
  echo "SAVEPOINT suite;"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$HERE/data_assinatura_editavel.sql"
  echo "ROLLBACK TO SAVEPOINT suite;"
  grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$DOWN"
  echo "\\echo [rollback ok]"
  echo "SELECT 'ok apos rollback: regra antiga de volta=' || (pg_get_functiondef('public.exclusive_set_signed_on(uuid,date)'::regprocedure) LIKE '%_c.created_on_sp%');"
  echo "ROLLBACK;"
} > "$TMP"
if [ -n "${PSQL:-}" ]; then
  $PSQL -X -q -At -v ON_ERROR_STOP=1 < "$TMP" 2>&1
else
  psql "${PGCONN:?defina PGCONN ou PSQL (local/teste, nunca produção)}" -X -q -At -v ON_ERROR_STOP=1 -f "$TMP" 2>&1
fi | sed "s#^psql:[^ ]* ##" | grep -E "^\[|^(ok|FALHA|TOTAL=)|ERROR|[Ee]rror:|LINE|DETAIL" || true

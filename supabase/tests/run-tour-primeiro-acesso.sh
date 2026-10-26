#!/usr/bin/env bash
# Migration 20261026120000 + teste de RLS na HOMOLOGAÇÃO (qvhyepwduhlgqwpgmpvh), numa ÚNICA transação desfeita.
# Usa a conexão protegida em ~/.config/max/adm-max-homolog-pg (nunca imprime senha).
# Uso: bash supabase/tests/run-tour-primeiro-acesso.sh [--rollback]
#   --rollback: aplica a migration, roda o teste, aplica o rollback e confere que a tabela sumiu.
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
CONN_DIR="${ADM_HOMOLOG_PG_DIR:-$HOME/.config/max/adm-max-homolog-pg}"
CONN="$(cat "$CONN_DIR/conn")"
case "$CONN" in *qvhyepwduhlgqwpgmpvh*) ;; *) echo "Recusado: conexão não é a homologação." >&2; exit 1 ;; esac
export PGPASSFILE="$CONN_DIR/pgpass"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  strip "$ROOT/supabase/migrations/20261026120000_tour_primeiro_acesso.sql"
  echo "\\echo [migration ok]"
  echo "\\echo [reaplicando: idempotente]"
  strip "$ROOT/supabase/migrations/20261026120000_tour_primeiro_acesso.sql"
  cat "$DIR/tour_primeiro_acesso.sql"
  if [ "${1:-}" = "--rollback" ]; then
    strip "$ROOT/docs/sql/rollback/20261026120000_tour_primeiro_acesso.rollback.sql"
    echo "SELECT CASE WHEN to_regclass('public.user_tour_estado') IS NULL THEN 'ok rollback: tabela removida' ELSE 'FALHA rollback' END;"
  fi
  echo "ROLLBACK;"
} | psql "$CONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=)|ERROR|LINE|DETAIL|psql:"

#!/usr/bin/env bash
# Ensaio da migration 20261008200000 (valor no pino de Vendas por região) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção):
# pré-requisitos (aplica 20261008150000 se faltar) -> suíte com pino SEM valor -> fingerprint A -> up ->
# suíte com pino COM valor + soma pinos/venda/grupo -> rollback -> fingerprint == A -> suíte sem valor -> ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-vendas-regiao-valor-pino.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
BASE="$ROOT/supabase/migrations/20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql"
UP="$ROOT/supabase/migrations/20261008200000_vendas_regiao_valor_no_pino.sql"
DOWN="$ROOT/supabase/rollback/20261008200000_vendas_regiao_valor_no_pino.sql"
SUITE="$HERE/vendas_regiao_todos.sql"
EXTRA="$HERE/vendas_regiao_valor_pino.sql"
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.proowner::regrole::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||polrelid::regclass::text||':'||polname FROM pg_policy) s),''));"
suite() { # $1 = on/off (pino com valor esperado)
  echo "SAVEPOINT s;"; echo "SELECT set_config('t.pino_valor', '$1', true);"
  strip "$SUITE"; [ "$1" = on ] && strip "$EXTRA"; echo "ROLLBACK TO SAVEPOINT s;"
}
{
  echo "BEGIN;"
  echo "ALTER TABLE public.exclusive_captures"
  echo "  ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by uuid,"
  echo "  ADD COLUMN IF NOT EXISTS discarded_at timestamptz, ADD COLUMN IF NOT EXISTS discarded_by uuid,"
  echo "  ADD COLUMN IF NOT EXISTS signed_on date, ADD COLUMN IF NOT EXISTS geo_lat double precision,"
  echo "  ADD COLUMN IF NOT EXISTS geo_lon double precision, ADD COLUMN IF NOT EXISTS geo_key text;"
  echo "SELECT to_regprocedure('public.vendas_por_regiao_todos(date,date)') IS NULL AS need_base \\gset"
  echo "\\if :need_base"
  strip "$BASE"
  echo "\\endif"
  echo "\\echo [antes: pino sem valor]"; suite off
  echo "$FP"
  strip "$UP"; echo "\\echo [up]"; suite on
  strip "$DOWN"; echo "$FP"
  echo "\\echo [depois do rollback: pino sem valor]"; suite off
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E '^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE' || true

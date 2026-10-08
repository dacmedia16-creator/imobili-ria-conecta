#!/usr/bin/env bash
# Ensaio da migration 20261008150000 numa ÚNICA transação revertida (homologação ou clone, nunca produção):
# pré-requisitos -> fingerprint A -> up -> suíte -> rollback -> fingerprint == A -> up -> suíte -> ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-vendas-regiao-todos.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
UP="$ROOT/supabase/migrations/20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql"
DOWN="$ROOT/supabase/rollback/20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql"
SUITE="$HERE/vendas_regiao_todos.sql"
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||polrelid::regclass::text||':'||polname FROM pg_policy) s),''));"
suite() { echo "SAVEPOINT s;"; strip "$SUITE"; echo "ROLLBACK TO SAVEPOINT s;"; }
# Pré-requisitos já em produção, ausentes na homologação (colunas de captação de 03/10). Só na transação.
pre() {
  cat <<'SQL'
ALTER TABLE public.exclusive_captures
  ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS discarded_at timestamptz, ADD COLUMN IF NOT EXISTS discarded_by uuid,
  ADD COLUMN IF NOT EXISTS signed_on date, ADD COLUMN IF NOT EXISTS geo_lat double precision,
  ADD COLUMN IF NOT EXISTS geo_lon double precision, ADD COLUMN IF NOT EXISTS geo_key text;
SQL
}
{
  echo "BEGIN;"
  pre
  echo "$FP"
  strip "$UP"; echo "\\echo [up 1]"; suite
  strip "$DOWN"; echo "$FP"
  strip "$UP"; echo "\\echo [up 2]"; suite
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E '^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE' || true

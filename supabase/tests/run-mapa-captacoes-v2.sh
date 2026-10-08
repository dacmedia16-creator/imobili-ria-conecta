#!/usr/bin/env bash
# Ensaio da migration 20261008170000 numa ÚNICA transação revertida (homologação ou clone, nunca produção):
# pré-requisitos (20261008150000) -> fingerprint A -> up -> suíte -> rollback -> fingerprint == A -> up -> suíte -> ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-mapa-captacoes-v2.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
PRE="$ROOT/supabase/migrations/20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql"
UP="$ROOT/supabase/migrations/20261008170000_mapa_captacoes_preco_contato.sql"
DOWN="$ROOT/supabase/rollback/20261008170000_mapa_captacoes_preco_contato.sql"
SUITE="$HERE/mapa_captacoes_v2.sql"
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||polrelid::regclass::text||':'||polname FROM pg_policy) s),''));"
suite() { echo "SAVEPOINT s;"; strip "$SUITE"; echo "ROLLBACK TO SAVEPOINT s;"; }
{
  echo "BEGIN;"
  # Colunas de captação já em produção e ausentes na homologação (só na transação).
  cat <<'SQL'
ALTER TABLE public.exclusive_captures
  ADD COLUMN IF NOT EXISTS archived_at timestamptz, ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS discarded_at timestamptz, ADD COLUMN IF NOT EXISTS discarded_by uuid,
  ADD COLUMN IF NOT EXISTS signed_on date, ADD COLUMN IF NOT EXISTS geo_lat double precision,
  ADD COLUMN IF NOT EXISTS geo_lon double precision, ADD COLUMN IF NOT EXISTS geo_key text;
SQL
  if ! psql "$PGCONN" -X -q -At -c "select 1 from pg_proc where proname='relatorio_regiao_permitido'" | grep -q 1; then
    strip "$PRE"
  fi
  echo "$FP"
  strip "$UP"; echo "\\echo [up 1]"; suite
  strip "$DOWN"; echo "$FP"
  strip "$UP"; echo "\\echo [up 2]"; suite
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E '^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE' || true

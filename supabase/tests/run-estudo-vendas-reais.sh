#!/usr/bin/env bash
# Vendas reais para o Estudo (migration 20261011100000) numa ÚNICA transação revertida (homologação ou
# clone, nunca produção): colunas da ficha se faltarem (só na transação) -> fingerprint A -> up -> suíte
# -> rollback -> fingerprint == A -> ROLLBACK.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-estudo-vendas-reais.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'tb:'||c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r') s),''));"
{
  echo "BEGIN;"
  # Homologação anterior à Ficha do imóvel (produção já tem): só as colunas lidas aqui.
  echo "ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tipo_imovel text, ADD COLUMN IF NOT EXISTS area_util_m2 numeric(12,2),"
  echo "  ADD COLUMN IF NOT EXISTS area_terreno_m2 numeric(12,2), ADD COLUMN IF NOT EXISTS quartos smallint,"
  echo "  ADD COLUMN IF NOT EXISTS suites smallint, ADD COLUMN IF NOT EXISTS banheiros smallint, ADD COLUMN IF NOT EXISTS vagas smallint;"
  echo "\\echo [pre ok]"
  echo "$FP"
  strip "$ROOT/supabase/migrations/20261011100000_estudo_vendas_reais.sql"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/estudo_vendas_reais.sql"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$ROOT/supabase/rollback/20261011100000_estudo_vendas_reais.sql"
  echo "\\echo [rollback ok]"
  echo "$FP"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

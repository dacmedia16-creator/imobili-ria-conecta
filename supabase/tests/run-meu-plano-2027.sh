#!/usr/bin/env bash
# "Meu Plano 2027" (migration 20261107120000, t_1ac2e95d) numa ÚNICA transação revertida:
# hash antes -> migration -> suíte -> rollback -> hash igual -> reaplica -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d <banco_local>" bash supabase/tests/run-meu-plano-2027.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261107120000_meu_plano_2027.sql"
RB="$ROOT/docs/sql/rollback/20261107120000_meu_plano_2027.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,'') x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname||':'||md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname FROM pg_policies WHERE schemaname='public') s),''));"
{
  echo "BEGIN;"
  echo "\\echo [antes]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite meu_plano_2027]"
  strip "$HERE/meu_plano_2027.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

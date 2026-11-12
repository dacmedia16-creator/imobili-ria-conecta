#!/usr/bin/env bash
# Banner do Início (migration 20261121120000, cartão t_75786f5c) numa ÚNICA transação revertida:
# hash antes -> migration -> suíte -> rollback -> hash igual ao de antes -> reaplica -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-home-banners.sh   (homologação ou banco local; nunca produção)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261121120000_home_banners.sql"
RB="$ROOT/docs/sql/rollback/20261121120000_home_banners.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(p.prosrc) x FROM pg_proc p
   WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'home_banner%'
  UNION ALL SELECT 'tb:'||c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname LIKE 'home_banner%'
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname FROM pg_policies WHERE schemaname IN ('public','storage')) s),''));"
{
  echo "BEGIN;"
  echo "\\echo [antes]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite home_banners]"
  strip "$HERE/home_banners.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

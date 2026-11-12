#!/usr/bin/env bash
# "Baixar meu plano em PDF" (migration 20261119120000, t_65edd0b0) numa ÚNICA transação revertida:
# hash antes -> migration -> suíte -> rollback -> hash igual ao de antes -> reaplica -> ROLLBACK. Nada fica gravado.
# Pré-requisito: o banco já tem a 20261107120000 (Meu Plano 2027) aplicada (homologação já tem).
# Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-meu-plano-2027-pdf.sh   (homologação; nunca produção)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261119120000_meu_plano_2027_pdf_lider.sql"
RB="$ROOT/docs/sql/rollback/20261119120000_meu_plano_2027_pdf_lider.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,'') x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE ANY (ARRAY['carreira_plano%','meu_plano%'])
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')) FROM pg_policies
    WHERE schemaname='public' AND tablename='carreira_plano') s),''));"
{
  echo "BEGIN;"
  echo "\\echo [antes]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite meu_plano_2027_pdf]"
  strip "$HERE/meu_plano_2027_pdf.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

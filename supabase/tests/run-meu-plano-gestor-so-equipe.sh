#!/usr/bin/env bash
# "Gestor vê só a própria equipe" (migration 20261218120000, t_889fb3c1/t_48670ed3) numa ÚNICA transação revertida:
# [aplica 20261119120000 se faltar] -> hash -> migration -> suíte -> rollback -> hash igual -> reaplica -> ROLLBACK.
# Nada fica gravado. Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-meu-plano-gestor-so-equipe.sh  (nunca produção)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
PRE="$ROOT/supabase/migrations/20261119120000_meu_plano_2027_pdf_lider.sql"
MIG="$ROOT/supabase/migrations/20261218120000_meu_plano_gestor_so_equipe.sql"
RB="$ROOT/supabase/rollback/20261218120000_meu_plano_gestor_so_equipe.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,'') x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE ANY (ARRAY['carreira_plano%','meu_plano%'])
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')) FROM pg_policies
    WHERE schemaname='public' AND tablename='carreira_plano') s),''));"
{
  echo "BEGIN;"
  strip "$PRE"   # idempotente (CREATE OR REPLACE / DROP POLICY IF EXISTS); a homologação pode ainda não ter
  echo "\\echo [pre-requisito 20261119120000 ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite meu_plano_gestor_so_equipe]"
  strip "$HERE/meu_plano_gestor_so_equipe.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

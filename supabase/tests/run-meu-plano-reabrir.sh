#!/usr/bin/env bash
# "Reabrir plano" do Meu Plano 2027 (migration 20261209130000, t_495e4305) numa ÚNICA transação revertida
# (homologação ou banco descartável, NUNCA produção): fingerprint A -> up -> suíte -> rollback ->
# fingerprint == A -> reaplica 2x (idempotência) -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-meu-plano-reabrir.sh
#      MIG=<outra migration> para o controle negativo (a suíte tem de falhar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
V=20261209130000
MIG="${MIG:-$ROOT/supabase/migrations/${V}_meu_plano_reabrir.sql}"
RB="$ROOT/docs/sql/rollback/${V}_meu_plano_reabrir.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal) s),''));"
{
  echo "BEGIN;"
  # Pré-requisito que a homologação pode não ter (produção tem desde 12/11): lista da equipe para o TL.
  echo "SELECT (to_regprocedure('public.meu_plano_lider_ve(uuid)') IS NULL) AS need_tl \\gset"
  echo "\\if :need_tl"
  strip "$ROOT/supabase/migrations/20261119120000_meu_plano_2027_pdf_lider.sql"
  echo "\\endif"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/meu_plano_reabrir.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  strip "$MIG"
  echo "\\echo [reaplicada 2x ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

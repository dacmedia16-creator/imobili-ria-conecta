#!/usr/bin/env bash
# Migration 20261225120000 (t_fee0b359: contagem do Dashboard + Sem equipe no ranking) numa ÚNICA transação
# revertida (homologação ou banco descartável, NUNCA produção): dados fictícios + foto ANTES -> fingerprint A ->
# migration -> suíte -> rollback -> fingerprint == A -> reaplica (idempotência) -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-conferencia-contagem-ranking.sh
#      MIG=<outra migration> para o controle negativo (a suíte tem de falhar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
V=20261225120000
N=conferencia_contagem_dashboard_ranking_sem_equipe
MIG="${MIG:-$ROOT/supabase/migrations/${V}_${N}.sql}"
RB="$ROOT/supabase/rollback/${V}_${N}.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal) s),''));"
{
  echo "BEGIN;"
  strip "$HERE/conferencia_contagem_ranking_seed.sql"
  echo "\\echo [dados e foto antes ok]"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/conferencia_contagem_ranking.sql"
  [ -n "${DBG:-}" ] && strip "$HERE/conferencia_contagem_ranking_debug.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  strip "$MIG"
  echo "\\echo [reaplicada 2x ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=|DBG)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

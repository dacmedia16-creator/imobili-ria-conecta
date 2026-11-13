#!/usr/bin/env bash
# Aprovação automática da captação do próprio gestor/TL (migration 20261123120000, t_e433a198) numa ÚNICA
# transação revertida (homologação ou clone, nunca produção): fingerprint A -> up -> suíte -> rollback ->
# fingerprint == A -> reaplica -> suíte de novo -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-captacao-autoaprovacao-clicksign.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261123120000_captacao_autoaprovacao_clicksign.sql"
RB="$ROOT/supabase/rollback/20261123120000_captacao_autoaprovacao_clicksign.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'ck:'||conname||':'||pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conrelid='public.clicksign_whatsapp_fila'::regclass) s),''));"
{
  echo "BEGIN;"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/captacao_autoaprovacao_clicksign.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

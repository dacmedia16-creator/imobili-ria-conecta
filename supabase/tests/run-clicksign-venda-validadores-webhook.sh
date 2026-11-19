#!/usr/bin/env bash
# Aviso da Clicksign na venda sem JWT + sem reenvio de assinado (migration 20261205120000, t_0c874b61), numa
# ÚNICA transação revertida (homologação ou banco descartável, nunca produção):
#   fingerprint A -> suíte SEM a migration (controle: deve falhar) -> up -> suíte -> rollback ->
#   fingerprint == A -> reaplica -> suíte de novo -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-clicksign-venda-validadores-webhook.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261205120000_clicksign_venda_validadores_webhook.sql"
RB="$ROOT/docs/sql/rollback/20261205120000_clicksign_venda_validadores_webhook.rollback.sql"
SUITE="$HERE/clicksign_venda_validadores_webhook.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.proowner::regrole::text||':'||p.prosecdef::text||':'||
         coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a),'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace) s),''));"
{
  echo "BEGIN;"
  # Homologação atrasada: eh_so_locacao (20261122120100_papel_locacao, já em produção) pode faltar. Cria só
  # nesta transação, com o texto de produção, antes da impressão digital.
  echo "SELECT to_regprocedure('public.eh_so_locacao(uuid)') IS NULL AS need_loc \\gset"
  echo "\\if :need_loc"
  echo "CREATE FUNCTION public.eh_so_locacao(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS \$f\$ SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role = 'locacao') AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role NOT IN ('locacao', 'fotografo')) \$f\$;"
  echo "\\echo [pre: eh_so_locacao criada só nesta transação]"
  echo "\\endif"
  echo "$FP"
  echo "\\echo [controle: suíte SEM a migration]"
  echo "SAVEPOINT controle;"
  strip "$SUITE"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT controle;"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$SUITE"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "SAVEPOINT suite2;"
  strip "$SUITE"
  echo "RESET ROLE;"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

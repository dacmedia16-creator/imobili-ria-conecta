#!/usr/bin/env bash
# Assinatura manual (migration 20261019160000): permissão por papel (gestor, team leader, jurídico, ADM,
# corretor, outra organização) e troca manual <-> Clicksign sem envio em dobro. ÚNICA transação revertida
# (homologação ou clone local, nunca produção).
# Uso: PSQL_CMD="bash supabase/multiempresa/lpsql.sh" CONTAINER=adm-hom-ensaio bash supabase/tests/run-assinatura-manual-papeis.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
if [ -n "${PSQL_CMD:-}" ]; then
  read -r -a RUN <<<"$PSQL_CMD"
else
  RUN=(psql "${PGCONN:?defina PGCONN (homologação ou clone, nunca produção) ou PSQL_CMD}" -X)
fi
{
  echo "BEGIN;"
  echo "SELECT to_regclass('public.clicksign_envelopes') IS NULL AS need_cap \\gset"
  echo "\\if :need_cap"; strip "$ROOT/supabase/migrations/20261018120000_clicksign_captacao.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_manage_authorize(uuid)') IS NULL AS need_manage \\gset"
  echo "\\if :need_manage"; strip "$ROOT/supabase/migrations/20261018150000_clicksign_gerenciar_envelope.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_sale_config(uuid)') IS NULL AS need_venda \\gset"
  echo "\\if :need_venda"; strip "$ROOT/supabase/migrations/20261018200000_clicksign_venda.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_reconcile_apply(uuid,text,uuid)') IS NULL AS need_aud \\gset"
  echo "\\if :need_aud"; strip "$ROOT/supabase/migrations/20261019090000_clicksign_auditoria.sql"; echo "\\endif"
  strip "$ROOT/supabase/migrations/20261019160000_assinatura_manual_escolha.sql"
  echo "\\echo [migration nova ok]"
  strip "$HERE/assinatura_manual_papeis.sql"
  echo "ROLLBACK;"
  echo "\\echo [rollback da transação ok]"
} | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

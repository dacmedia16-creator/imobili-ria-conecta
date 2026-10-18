#!/usr/bin/env bash
# Suíte da migration 20261019100000 (t_f8dc8b99) numa transação REVERTIDA (homologação ou clone local,
# nunca produção). Aplica antes, só na transação, as migrations da Clicksign que faltarem e a
# 20261019090000 (t_eb3f23e0). Nenhum WhatsApp/e-mail é enviado: a fila só é gravada e lida.
# Uso: PSQL_CMD="bash supabase/multiempresa/lpsql.sh" CONTAINER=adm-hom-ensaio bash supabase/tests/run-clicksign-avisos.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
if [ -n "${PSQL_CMD:-}" ]; then read -r -a RUN <<<"$PSQL_CMD"; else
  RUN=(psql "${PGCONN:?defina PGCONN (homologação ou clone, nunca produção) ou PSQL_CMD}" -X); fi
SUITES=("$HERE/clicksign_avisos.sql")
# REGRESSAO=1: também roda a suíte da venda e a da auditoria com os gatilhos novos ativos.
[ "${REGRESSAO:-0}" = 1 ] && SUITES+=("$HERE/clicksign_venda.sql" "$HERE/clicksign_auditoria.sql")
for SUITE in "${SUITES[@]}"; do
echo "== $(basename "$SUITE")"
{
  echo "BEGIN;"
  # Colunas que produção já tem e a adm-hom-ensaio não (conferido em produção, só leitura).
  echo "ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;"
  echo "ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS exclusive_capture_id uuid;"
  echo "SELECT to_regclass('public.clicksign_envelopes') IS NULL AS need_cap \\gset"
  echo "\\if :need_cap"; strip "$ROOT/supabase/migrations/20261018120000_clicksign_captacao.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_manage_authorize(uuid)') IS NULL AS need_manage \\gset"
  echo "\\if :need_manage"; strip "$ROOT/supabase/migrations/20261018150000_clicksign_gerenciar_envelope.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_sale_config(uuid)') IS NULL AS need_venda \\gset"
  echo "\\if :need_venda"; strip "$ROOT/supabase/migrations/20261018200000_clicksign_venda.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_reconcile_apply(uuid,text,uuid)') IS NULL AS need_aud \\gset"
  echo "\\if :need_aud"; strip "$ROOT/supabase/migrations/20261019090000_clicksign_auditoria.sql"; echo "\\endif"
  strip "$ROOT/supabase/migrations/20261019100000_clicksign_avisos_assinado.sql"
  echo "\\echo [migration ok]"
  strip "$SUITE"
  echo "ROLLBACK;"
  echo "\\echo [rollback da transação ok]"
} | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 ${PSQL_EXTRA:-} 2>&1 \
  | grep -E "${FILTRO:-^\[|^(ok|FALHA|TOTAL=|DIAG)|ERROR|LINE|DETAIL|CONTEXT|psql:}" || true
done

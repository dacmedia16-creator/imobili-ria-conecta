#!/usr/bin/env bash
# Pacote da auditoria Clicksign (migration 20261019090000) em transações REVERTIDAS (homologação ou
# clone local, nunca produção). Aplica antes, só na transação, as migrations da Clicksign que faltarem.
#  1) suíte nova (clicksign_auditoria.sql);
#  2) regressão: suíte da venda (clicksign_venda.sql) com a migration nova aplicada.
# Uso: PSQL_CMD="bash supabase/multiempresa/lpsql.sh" CONTAINER=adm-hom-ensaio bash supabase/tests/run-clicksign-auditoria.sh
#  ou: PGCONN="<conninfo da homologação>" bash supabase/tests/run-clicksign-auditoria.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
if [ -n "${PSQL_CMD:-}" ]; then
  read -r -a RUN <<<"$PSQL_CMD"
else
  RUN=(psql "${PGCONN:?defina PGCONN (homologação ou clone, nunca produção) ou PSQL_CMD}" -X)
fi
pre() {
  echo "SELECT to_regclass('public.clicksign_envelopes') IS NULL AS need_cap \\gset"
  echo "\\if :need_cap"
  strip "$ROOT/supabase/migrations/20261018120000_clicksign_captacao.sql"
  echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_manage_authorize(uuid)') IS NULL AS need_manage \\gset"
  echo "\\if :need_manage"
  strip "$ROOT/supabase/migrations/20261018150000_clicksign_gerenciar_envelope.sql"
  echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_sale_config(uuid)') IS NULL AS need_venda \\gset"
  echo "\\if :need_venda"
  strip "$ROOT/supabase/migrations/20261018200000_clicksign_venda.sql"
  echo "\\endif"
  strip "$ROOT/supabase/migrations/20261019090000_clicksign_auditoria.sql"
  echo "\\echo [migration ok]"
}
filter() { grep -E "^\[|^(ok|FALHA|TOTAL=|DIAG)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true; }
echo "== suíte nova"
{ echo "BEGIN;"; pre; strip "$HERE/clicksign_auditoria.sql"; echo "ROLLBACK;"; echo "\\echo [rollback da transação ok]"; } \
  | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 2>&1 | filter
echo "== regressão: suíte da venda com a migration nova"
{ echo "BEGIN;"; pre; strip "$HERE/clicksign_venda.sql"; echo "ROLLBACK;"; echo "\\echo [rollback da transação ok]"; } \
  | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 2>&1 | filter

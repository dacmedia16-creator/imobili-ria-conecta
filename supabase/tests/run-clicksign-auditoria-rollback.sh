#!/usr/bin/env bash
# Ensaio do rollback da migration 20261019090000 numa ÚNICA transação revertida (homologação ou clone,
# nunca produção): guarda o md5 das funções antes, aplica a migration, aplica o rollback e confere que
# voltou exatamente ao anterior.
# Uso: PSQL_CMD="bash supabase/multiempresa/lpsql.sh" CONTAINER=adm-hom-ensaio bash supabase/tests/run-clicksign-auditoria-rollback.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
if [ -n "${PSQL_CMD:-}" ]; then
  read -r -a RUN <<<"$PSQL_CMD"
else
  RUN=(psql "${PGCONN:?defina PGCONN (homologação ou clone, nunca produção) ou PSQL_CMD}" -X)
fi
FUNCS="'clicksign_sender_ok','clicksign_capture_authorize','clicksign_attach_signed','clicksign_manage_authorize','clicksign_capture_config','clicksign_sale_config','clicksign_sale_extra_candidates','clicksign_sale_attach_signed'"
MD="SELECT md5(string_agg(pg_get_functiondef(p.oid) || p.proacl::text, '|' ORDER BY p.proname)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ($FUNCS)"
{
  echo "BEGIN;"
  echo "SELECT to_regclass('public.clicksign_envelopes') IS NULL AS need_cap \\gset"
  echo "\\if :need_cap"; strip "$ROOT/supabase/migrations/20261018120000_clicksign_captacao.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_manage_authorize(uuid)') IS NULL AS need_manage \\gset"
  echo "\\if :need_manage"; strip "$ROOT/supabase/migrations/20261018150000_clicksign_gerenciar_envelope.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_sale_config(uuid)') IS NULL AS need_venda \\gset"
  echo "\\if :need_venda"; strip "$ROOT/supabase/migrations/20261018200000_clicksign_venda.sql"; echo "\\endif"
  echo "SELECT ($MD) AS md_antes \\gset"
  strip "$ROOT/supabase/migrations/20261019090000_clicksign_auditoria.sql"
  echo "\\echo [migration ok]"
  echo "SELECT CASE WHEN ($MD) <> :'md_antes' THEN 'ok    migration mudou as funções' ELSE 'FALHA migration não mudou nada' END;"
  strip "$ROOT/supabase/rollback/20261019090000_clicksign_auditoria.sql"
  echo "\\echo [rollback ok]"
  echo "SELECT CASE WHEN ($MD) = :'md_antes' THEN 'ok    8 funções idênticas às anteriores (corpo e grants)' ELSE 'FALHA funções diferentes após rollback' END;"
  cat <<'SQL'
SELECT CASE WHEN to_regprocedure('public.clicksign_capture_sender_ok(uuid,uuid)') IS NULL
  AND to_regprocedure('public.clicksign_reconcile_authorize(text,uuid)') IS NULL
  AND to_regprocedure('public.clicksign_reconcile_apply(uuid,text,uuid)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clicksign_envelopes' AND column_name = 'error_detail')
  THEN 'ok    funções novas e error_detail removidas' ELSE 'FALHA sobrou objeto novo' END;
SQL
  echo "ROLLBACK;"
} | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

#!/usr/bin/env bash
# Ensaio do rollback da migration 20261019160000 numa ÚNICA transação revertida (homologação ou clone,
# nunca produção): guarda o md5 das funções antes, aplica a migration, aplica o rollback e confere que
# voltou exatamente ao anterior e que as policies/funções novas sumiram.
# Uso: PSQL_CMD="bash supabase/multiempresa/lpsql.sh" CONTAINER=adm-hom-ensaio bash supabase/tests/run-assinatura-manual-rollback.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
if [ -n "${PSQL_CMD:-}" ]; then
  read -r -a RUN <<<"$PSQL_CMD"
else
  RUN=(psql "${PGCONN:?defina PGCONN (homologação ou clone, nunca produção) ou PSQL_CMD}" -X)
fi
FUNCS="'validate_sale_status_transition','clicksign_sale_authorize','clicksign_capture_authorize','clicksign_sale_canceled'"
MD="SELECT md5(string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), '|' ORDER BY p.proname)) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ($FUNCS)"
NOVOS="SELECT (SELECT count(*) FROM pg_policy WHERE polname IN ('juridico_contrato_assinado_insert','juridico_contrato_assinado_storage_insert')) + (SELECT count(*) FROM pg_proc WHERE proname IN ('can_upload_contrato_assinado_juridico','clicksign_capture_canceled_papel'))"
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
  echo "SELECT ($MD) AS md_antes \\gset"
  strip "$ROOT/supabase/migrations/20261019160000_assinatura_manual_escolha.sql"
  echo "\\echo [migration ok]"
  echo "SELECT CASE WHEN ($MD) <> :'md_antes' AND ($NOVOS) = 4 THEN 'ok    migration mudou as funções e criou 2 policies + 2 funções' ELSE 'FALHA migration não aplicou o esperado' END;"
  strip "$ROOT/supabase/rollback/20261019160000_assinatura_manual_escolha.sql"
  echo "\\echo [rollback ok]"
  echo "SELECT CASE WHEN ($MD) = :'md_antes' THEN 'ok    funções voltaram idênticas ao anterior' ELSE 'FALHA funções diferentes do anterior' END;"
  echo "SELECT CASE WHEN ($NOVOS) = 0 THEN 'ok    policies e funções novas removidas' ELSE 'FALHA sobrou policy/função nova' END;"
  echo "ROLLBACK;"
  echo "\\echo [rollback da transação ok]"
} | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

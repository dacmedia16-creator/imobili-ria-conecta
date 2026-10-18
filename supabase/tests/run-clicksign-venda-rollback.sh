#!/usr/bin/env bash
# Ensaio do rollback da migration 20261018200000 numa ÚNICA transação revertida (homologação ou clone
# local, nunca produção): aplica a migration, aplica o rollback e confere que voltou ao formato anterior.
# Uso: PGCONN="<conninfo>" bash supabase/tests/run-clicksign-venda-rollback.sh  (ou PSQL_CMD=...)
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
  echo "\\if :need_cap"
  strip "$ROOT/supabase/migrations/20261018120000_clicksign_captacao.sql"
  echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_manage_authorize(uuid)') IS NULL AS need_manage \\gset"
  echo "\\if :need_manage"
  strip "$ROOT/supabase/migrations/20261018150000_clicksign_gerenciar_envelope.sql"
  echo "\\endif"
  echo "SELECT md5(pg_get_functiondef('public.clicksign_manage_done(uuid,uuid,text,text,jsonb,boolean)'::regprocedure)) AS md_antes \\gset"
  echo "SELECT md5(pg_get_functiondef('public.criar_ocorrencia_completa(uuid)'::regprocedure) || pg_get_functiondef('public.sincronizar_ocorrencia_antes_financeiro(uuid)'::regprocedure)) AS md_occ_antes \\gset"
  strip "$ROOT/supabase/migrations/20261018200000_clicksign_venda.sql"
  echo "\\echo [migration ok]"
  strip "$ROOT/supabase/rollback/20261018200000_clicksign_venda.sql"
  echo "\\echo [rollback ok]"
  cat <<'SQL'
SELECT CASE WHEN to_regprocedure('public.clicksign_sale_config(uuid)') IS NULL
  AND to_regprocedure('public.clicksign_sale_attach_signed(uuid,text,text)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clicksign_envelopes' AND column_name = 'sale_id')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clicksign_org_settings' AND column_name = 'sale_enabled')
  AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_zz_clicksign_contrato_novo','trg_zz_clicksign_saiu_assinatura'))
  AND (SELECT is_nullable FROM information_schema.columns WHERE table_name = 'clicksign_envelopes' AND column_name = 'capture_id') = 'NO'
  THEN 'ok    rollback removeu a venda e voltou capture_id obrigatório' ELSE 'FALHA rollback incompleto' END;
SQL
  echo "SELECT CASE WHEN md5(pg_get_functiondef('public.clicksign_manage_done(uuid,uuid,text,text,jsonb,boolean)'::regprocedure)) = :'md_antes' THEN 'ok    clicksign_manage_done idêntica à anterior' ELSE 'FALHA clicksign_manage_done diferente' END;"
  echo "SELECT CASE WHEN md5(pg_get_functiondef('public.criar_ocorrencia_completa(uuid)'::regprocedure) || pg_get_functiondef('public.sincronizar_ocorrencia_antes_financeiro(uuid)'::regprocedure)) = :'md_occ_antes' THEN 'ok    RPCs da ocorrência idênticas às anteriores' ELSE 'FALHA RPCs da ocorrência diferentes' END;"
  echo "ROLLBACK;"
} | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

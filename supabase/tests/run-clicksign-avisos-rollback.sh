#!/usr/bin/env bash
# Ensaio da migration 20261019100000 (t_f8dc8b99) e do rollback numa ÚNICA transação revertida
# (homologação ou clone local, nunca produção). Aplica antes, só na transação, as migrations da
# Clicksign que faltarem e a 20261019090000 (t_eb3f23e0).
# Uso: PSQL_CMD="bash supabase/multiempresa/lpsql.sh" CONTAINER=adm-hom-ensaio bash supabase/tests/run-clicksign-avisos-rollback.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
if [ -n "${PSQL_CMD:-}" ]; then read -r -a RUN <<<"$PSQL_CMD"; else
  RUN=(psql "${PGCONN:?defina PGCONN (homologação ou clone, nunca produção) ou PSQL_CMD}" -X); fi
POL="SELECT md5(pg_get_expr(polqual, polrelid)) FROM pg_policy WHERE polrelid = 'public.exclusive_documents'::regclass AND polname = 'exclusive_documents_read'"
{
  echo "BEGIN;"
  # A adm-hom-ensaio não tem a coluna manual (produção tem); só nesta transação revertida.
  echo "ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;"
  echo "SELECT to_regclass('public.clicksign_envelopes') IS NULL AS need_cap \\gset"
  echo "\\if :need_cap"; strip "$ROOT/supabase/migrations/20261018120000_clicksign_captacao.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_manage_authorize(uuid)') IS NULL AS need_manage \\gset"
  echo "\\if :need_manage"; strip "$ROOT/supabase/migrations/20261018150000_clicksign_gerenciar_envelope.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_sale_config(uuid)') IS NULL AS need_venda \\gset"
  echo "\\if :need_venda"; strip "$ROOT/supabase/migrations/20261018200000_clicksign_venda.sql"; echo "\\endif"
  echo "SELECT to_regprocedure('public.clicksign_reconcile_apply(uuid,text,uuid)') IS NULL AS need_aud \\gset"
  echo "\\if :need_aud"; strip "$ROOT/supabase/migrations/20261019090000_clicksign_auditoria.sql"; echo "\\endif"
  echo "SELECT ($POL) AS pol_antes \\gset"
  strip "$ROOT/supabase/migrations/20261019100000_clicksign_avisos_assinado.sql"
  echo "\\echo [migration ok]"
  cat <<'SQL'
SELECT CASE WHEN to_regprocedure('public.clicksign_aviso_assinou(uuid,text,bigint)') IS NOT NULL
  AND to_regclass('public.clicksign_whatsapp_fila') IS NOT NULL
  AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('clicksign_envelope_aviso','clicksign_envelope_prazo')) = 2
  THEN 'ok    objetos novos criados' ELSE 'FALHA objetos novos ausentes' END;
SELECT CASE WHEN public.clicksign_lembrete_prazo(now()) >= 0 THEN 'ok    lembrete de prazo roda' END;
SELECT CASE WHEN (SELECT count(*) FROM public.clicksign_whatsapp_pendentes(10)) >= 0 THEN 'ok    fila do WhatsApp lê' END;
SQL
  echo "SELECT CASE WHEN ($POL) <> :'pol_antes' THEN 'ok    policy mudou' ELSE 'FALHA policy não mudou' END;"
  strip "$ROOT/supabase/rollback/20261019100000_clicksign_avisos_assinado.sql"
  echo "\\echo [rollback ok]"
  echo "SELECT CASE WHEN ($POL) = :'pol_antes' THEN 'ok    policy idêntica à anterior' ELSE 'FALHA policy diferente após rollback' END;"
  cat <<'SQL'
SELECT CASE WHEN to_regclass('public.clicksign_whatsapp_fila') IS NULL AND to_regclass('public.clicksign_avisos') IS NULL
  AND to_regprocedure('public.clicksign_aviso_assinou(uuid,text,bigint)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clicksign_envelopes' AND column_name = 'deadline_at')
  AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('clicksign_envelope_aviso','clicksign_envelope_prazo'))
  THEN 'ok    objetos novos removidos' ELSE 'FALHA sobrou objeto novo' END;
SQL
  echo "ROLLBACK;"
} | "${RUN[@]}" -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

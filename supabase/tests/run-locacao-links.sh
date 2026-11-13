#!/usr/bin/env bash
# Somente banco de HOMOLOGAÇÃO/clone. Migration e fixtures em transação revertida.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${PGCONN:?Defina a conexão de homologação; nunca produção}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);[[:space:]]*$' "$1"; }
{
  echo 'BEGIN;'
  echo "CREATE TEMP TABLE fp AS SELECT md5(pg_get_functiondef('public.locacao_detalhe(uuid)'::regprocedure)) a, md5(pg_get_functiondef('public.locacao_enviar_documentacao(uuid)'::regprocedure)) b, md5(pg_get_functiondef('public.locacao_docs_completos_em(public.locacoes)'::regprocedure)) c;"
  strip "$ROOT/supabase/migrations/20261124120000_locacao_cliente_preenche.sql"
  strip "$ROOT/supabase/tests/locacao-links.sql"
  echo 'RESET ROLE;'
  strip "$ROOT/supabase/rollback/20261124120000_locacao_cliente_preenche.sql"
  echo "SELECT 'ROLLBACK_OK=' || (to_regclass('public.locacao_links') IS NULL);"
  echo "SELECT 'FUNCOES_RESTAURADAS=' || (SELECT a=md5(pg_get_functiondef('public.locacao_detalhe(uuid)'::regprocedure)) AND b=md5(pg_get_functiondef('public.locacao_enviar_documentacao(uuid)'::regprocedure)) AND c=md5(pg_get_functiondef('public.locacao_docs_completos_em(public.locacoes)'::regprocedure)) FROM fp);"
  echo "DO \$\$ BEGIN IF to_regclass('public.locacao_links') IS NOT NULL OR NOT (SELECT a=md5(pg_get_functiondef('public.locacao_detalhe(uuid)'::regprocedure)) AND b=md5(pg_get_functiondef('public.locacao_enviar_documentacao(uuid)'::regprocedure)) AND c=md5(pg_get_functiondef('public.locacao_docs_completos_em(public.locacoes)'::regprocedure)) FROM fp) THEN RAISE EXCEPTION 'rollback divergente'; END IF; END \$\$;"
  echo 'ROLLBACK;'
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1

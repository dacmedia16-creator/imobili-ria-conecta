#!/usr/bin/env bash
# Roda a migration 20261230120000 + suíte + rollback numa transação SÓ, que termina em ROLLBACK
# (nada fica gravado). Uso: CONTAINER=adm-hom-ensaio bash supabase/tests/run-captacao-remover-proprietario.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
C="${CONTAINER:-adm-hom-ensaio}"
strip() { grep -v -E '^(BEGIN|COMMIT);$' "$1"; }
{
  echo 'BEGIN;'
  strip supabase/migrations/20261230120000_captacao_remover_proprietario_com_documentos.sql
  cat supabase/tests/captacao_remover_proprietario.sql
  strip supabase/rollback/20261230120000_captacao_remover_proprietario_com_documentos.sql
  echo "SELECT 'ROLLBACK_OK ' || (to_regprocedure('public.exclusive_remove_owner(uuid,integer,integer)') IS NULL);"
  echo 'ROLLBACK;'
} | docker exec -i "$C" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -At

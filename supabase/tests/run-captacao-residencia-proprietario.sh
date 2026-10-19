#!/usr/bin/env bash
# Roda a migration 20261019200000 + suíte + rollback numa transação SÓ, que termina em ROLLBACK
# (nada fica gravado). Uso: CONTAINER=adm-hom-ensaio bash supabase/tests/run-captacao-residencia-proprietario.sh
# SCAFFOLD_MANUAL=1: cria a coluna exclusive_captures.manual dentro da transação, para homologação
# local anterior a 20261008160000 (a função usa a coluna). Também revertido no fim.
set -euo pipefail
cd "$(dirname "$0")/../.."
C="${CONTAINER:-adm-hom-ensaio}"
strip() { grep -v -E '^(BEGIN|COMMIT);$' "$1"; }
{
  echo 'BEGIN;'
  if [ "${SCAFFOLD_MANUAL:-0}" = 1 ]; then
    echo 'ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;'
  fi
  strip supabase/migrations/20261019200000_captacao_residencia_proprietario.sql
  cat supabase/tests/captacao_residencia_proprietario.sql
  # Rollback depois de limpar os comprovantes de proprietário criados pela suíte.
  echo "DELETE FROM public.exclusive_documents WHERE kind = 'residencia' AND owner_index <> 0;"
  strip supabase/rollback/20261019200000_captacao_residencia_proprietario.sql
  echo "SELECT 'ROLLBACK_OK ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'exclusive_documents_check';"
  echo 'ROLLBACK;'
} | docker exec -i "$C" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 -At

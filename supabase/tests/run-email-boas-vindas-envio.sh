#!/usr/bin/env bash
# Roda a migration 20261020180000 + teste num Postgres LOCAL em container (cópia do schema), em transação desfeita.
# Uso: supabase/tests/run-email-boas-vindas-envio.sh <nome-do-container>   Sucesso = "RESULTADO OK".
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
C="${1:?informe o container local}"
OUT="$( { echo 'begin;'; grep -v -E '^(begin|commit);$' "$DIR/../migrations/20261020180000_email_boas_vindas_envio.sql";
          cat "$DIR/email_boas_vindas_envio.sql"; echo 'rollback;'; } \
  | docker exec -i "$C" psql -U postgres -v ON_ERROR_STOP=1 -X -q -P pager=off 2>&1)"
echo "$OUT" | grep -E "RESULTADO OK|ERROR|exception" | head -5
echo "$OUT" | grep -q "RESULTADO OK"

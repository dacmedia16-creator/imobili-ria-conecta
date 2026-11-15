#!/usr/bin/env bash
# Suíte do aquecimento de leads parados (t_a2cae373) na HOMOLOGAÇÃO, com a migration 20261125120000 aplicada.
# A suíte roda numa transação desfeita (ROLLBACK no fim): nada fica gravado.
# Uso: PSQL="bash <dir>/hq.sh -" bash supabase/tests/run-leads-aquecer.sh
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
: "${PSQL:?defina PSQL (psql da homologação lendo SQL do stdin)}"
OUT=$($PSQL < "$DIR/leads_aquecer.sql")
echo "$OUT"
echo "$OUT" | grep -q '^FAIL' && exit 1
echo "$OUT" | grep -q '^RESULTADO ' || exit 1

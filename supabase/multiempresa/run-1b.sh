#!/usr/bin/env bash
# Ensaio do marco 1b somente no clone local adm-mt-clone, após run-1a.sh.
# Testes A/B fazem ROLLBACK; o down falha fechado se existir agência nova persistida.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export CONTAINER="${CONTAINER:-adm-mt-clone}"
[[ "$CONTAINER" == "adm-mt-clone" ]] || { echo "Use apenas o clone local adm-mt-clone" >&2; exit 1; }
PSQL=(bash "$HERE/lpsql.sh")
UP="$HERE/migrations/20260928010000_mt_fase1b_escopo.sql"
DOWN="$HERE/migrations/20260928010000_mt_fase1b_escopo.down.sql"
"${PSQL[@]}" -At -c "SELECT 1 FROM public.organizations LIMIT 1" > /dev/null
[[ "$("${PSQL[@]}" -At -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='activity_logs' AND column_name='organization_id'")" == "0" ]] || { echo "1b já aplicada; aborte para inspecionar" >&2; exit 1; }
FP0="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
"${PSQL[@]}" < "$UP"
"${PSQL[@]}" -At < "$HERE/tests/isolation_1a.sql" | grep '^TOTAL='
"${PSQL[@]}" -At < "$HERE/tests/isolation_1b.sql" | grep '^TOTAL='
"${PSQL[@]}" < "$DOWN"
FP2="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
[[ "$FP0" == "$FP2" ]] || { echo "Rollback 1b divergente: $FP0 / $FP2" >&2; exit 1; }
echo "Rollback 1b: schema idêntico ($FP2)"
"${PSQL[@]}" < "$UP"
"${PSQL[@]}" -At < "$HERE/tests/isolation_1a.sql" | grep '^TOTAL='
"${PSQL[@]}" -At < "$HERE/tests/isolation_1b.sql" | grep '^TOTAL='
echo "Reaplicação 1b: OK; clone local permanece com 1a+1b"

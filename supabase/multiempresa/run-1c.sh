#!/usr/bin/env bash
# Marco 1c somente no clone local 1a+1b. Nenhum objeto físico é copiado/renomeado.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export CONTAINER="${CONTAINER:-adm-mt-clone}"
[[ "$CONTAINER" == "adm-mt-clone" ]] || { printf 'Somente clone local adm-mt-clone\n' >&2; exit 1; }
PSQL=(bash "$HERE/lpsql.sh")
UP="$HERE/migrations/20260928020000_mt_fase1c_storage.sql"
DOWN="$HERE/migrations/20260928020000_mt_fase1c_storage.down.sql"
[[ "$("${PSQL[@]}" -At -c "SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'")" == "17" ]] || { printf 'Clone deve ter 1a+1b e não pode ter 1c\n' >&2; exit 1; }
"${PSQL[@]}" -At -c 'SELECT 1 FROM public.mt_1b_function_backup LIMIT 1' > /dev/null
FP0="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
LEGACY0="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.profiles")"
for pass in 1 2; do
  "${PSQL[@]}" < "$UP"
  for suite in 1a 1b 1c; do
    "${PSQL[@]}" -At < "$HERE/tests/isolation_${suite}.sql" | grep '^TOTAL='
  done
  if [[ "$pass" == "1" ]]; then
    "${PSQL[@]}" < "$DOWN"
    FP2="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
    LEGACY2="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.profiles")"
    [[ "$FP0" == "$FP2" && "$LEGACY0" == "$LEGACY2" ]] || { printf 'Rollback divergente: fingerprint ou perfis\n' >&2; exit 1; }
    printf 'Rollback 1c idêntico: %s; perfis legados: %s\n' "$FP2" "$LEGACY2"
  fi
done
printf 'Reaplicação 1c OK; clone permanece 1a+1b+1c\n'

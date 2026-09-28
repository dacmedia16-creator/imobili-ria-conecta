#!/usr/bin/env bash
# Marco 1d somente no clone local 1a+1b+1c (container adm-mt-clone) + PostgREST local (127.0.0.1).
# Duas passagens up/down/up: suítes SQL 1a/1b/1c/1d e testes Vitest A↔B das rotinas service_role.
# Nenhum envio de WhatsApp (o envio é substituído por função de teste), nada remoto.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export CONTAINER="${CONTAINER:-adm-mt-clone}"
[[ "$CONTAINER" == "adm-mt-clone" ]] || { printf 'Somente clone local adm-mt-clone\n' >&2; exit 1; }
PSQL=(bash "$HERE/lpsql.sh")
UP="$HERE/migrations/20260928030000_mt_fase1d_service_role.sql"
DOWN="$HERE/migrations/20260928030000_mt_fase1d_service_role.down.sql"
STATE="${TMPDIR:-/tmp}/adm-mt-rest"
[[ "$("${PSQL[@]}" -At -c "SELECT count(*) FROM pg_policies WHERE schemaname='storage'")" == "22" ]] || { printf 'Clone deve ter 1a+1b+1c\n' >&2; exit 1; }
[[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_1d_function_backup') IS NULL")" == "t" ]] || { printf 'Clone já tem 1d; rode o down antes\n' >&2; exit 1; }
FP0="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
LEGACY0="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.profiles")"
bash "$HERE/local-rest.sh" up
trap 'bash "$HERE/local-rest.sh" down' EXIT
for pass in 1 2; do
  "${PSQL[@]}" < "$UP"
  for suite in 1a 1b 1c 1d; do
    "${PSQL[@]}" -At < "$HERE/tests/isolation_${suite}.sql" | grep '^TOTAL='
  done
  "${PSQL[@]}" < "$HERE/tests/fixture_1d_rest.sql"
  # PostgREST recarrega o cache de schema (colunas organization_id) antes dos testes.
  "${PSQL[@]}" -c "NOTIFY pgrst, 'reload schema'" > /dev/null; sleep 2
  status=0
  (cd "$REPO" && MT1D_REST_URL=http://127.0.0.1:55501 MT1D_REST_TOKEN_FILE="$STATE/service_token" \
    ./node_modules/.bin/vitest run src/lib/multiempresa-1d.integration.test.ts) || status=$?
  "${PSQL[@]}" < "$HERE/tests/fixture_1d_rest_cleanup.sql"
  [[ "$status" == "0" ]] || { printf 'Vitest 1d falhou (passagem %s)\n' "$pass" >&2; exit 1; }
  if [[ "$pass" == "1" ]]; then
    "${PSQL[@]}" < "$DOWN"
    FP2="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
    LEGACY2="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.profiles")"
    [[ "$FP0" == "$FP2" && "$LEGACY0" == "$LEGACY2" ]] || { printf 'Rollback divergente: fingerprint ou perfis\n' >&2; exit 1; }
    printf 'Rollback 1d idêntico: %s; perfis legados: %s\n' "$FP2" "$LEGACY2"
  fi
done
printf 'Reaplicação 1d OK; clone permanece 1a+1b+1c+1d\n'

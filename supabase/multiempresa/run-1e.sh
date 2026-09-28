#!/usr/bin/env bash
# Marco 1e somente no clone local 1a+1b+1c+1d (container adm-mt-clone) + PostgREST local (127.0.0.1).
# Duas passagens up/down/up: suítes SQL 1a–1e, Vitest 1d (rotinas service_role) e 1e (matriz
# papel × ação × agência no servidor e no banco via JWT de usuário). Nada remoto, nenhum envio.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
export CONTAINER="${CONTAINER:-adm-mt-clone}"
[[ "$CONTAINER" == "adm-mt-clone" ]] || { printf 'Somente clone local adm-mt-clone\n' >&2; exit 1; }
PSQL=(bash "$HERE/lpsql.sh")
UP="$HERE/migrations/20260928040000_mt_fase1e_fronteira_admin.sql"
DOWN="$HERE/migrations/20260928040000_mt_fase1e_fronteira_admin.down.sql"
STATE="${TMPDIR:-/tmp}/adm-mt-rest"
[[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_1d_function_backup') IS NOT NULL")" == "t" ]] || { printf 'Clone deve ter 1a+1b+1c+1d\n' >&2; exit 1; }
if [[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_1e_function_backup') IS NOT NULL")" == "t" ]]; then
  "${PSQL[@]}" < "$DOWN"; printf 'Clone tinha 1e: down aplicado antes do ensaio\n'
fi
FP0="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
LEGACY0="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.profiles")"
bash "$HERE/local-rest.sh" up
trap 'bash "$HERE/local-rest.sh" down' EXIT
vitest_pass() { # $1 = suite (1d|1e)
  local status=0
  "${PSQL[@]}" < "$HERE/tests/fixture_$1_rest.sql"
  "${PSQL[@]}" -c "NOTIFY pgrst, 'reload schema'" > /dev/null; sleep 2
  (cd "$REPO" && MT1D_REST_URL=http://127.0.0.1:55501 MT1D_REST_TOKEN_FILE="$STATE/service_token" \
    MT1E_REST_URL=http://127.0.0.1:55501 MT1E_REST_TOKEN_FILE="$STATE/service_token" \
    MT1E_REST_SECRET_FILE="$STATE/secret" \
    ./node_modules/.bin/vitest run "src/lib/multiempresa-$1.integration.test.ts") || status=$?
  "${PSQL[@]}" < "$HERE/tests/fixture_$1_rest_cleanup.sql"
  [[ "$status" == "0" ]] || { printf 'Vitest %s falhou\n' "$1" >&2; exit 1; }
}
for pass in 1 2; do
  "${PSQL[@]}" < "$UP"
  for suite in 1a 1b 1c 1d 1e; do
    "${PSQL[@]}" -At < "$HERE/tests/isolation_${suite}.sql" | grep '^TOTAL='
  done
  vitest_pass 1d
  vitest_pass 1e
  if [[ "$pass" == "1" ]]; then
    "${PSQL[@]}" < "$DOWN"
    FP2="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
    LEGACY2="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.profiles")"
    [[ "$FP0" == "$FP2" && "$LEGACY0" == "$LEGACY2" ]] || { printf 'Rollback divergente: fingerprint ou perfis\n' >&2; exit 1; }
    printf 'Rollback 1e idêntico: %s; perfis legados: %s\n' "$FP2" "$LEGACY2"
    # Com 1e desfeito, as suítes 1a–1d continuam verdes (base anterior preservada).
    for suite in 1a 1b 1c 1d; do
      "${PSQL[@]}" -At < "$HERE/tests/isolation_${suite}.sql" | grep '^TOTAL=' | sed 's/^/[sem 1e] /'
    done
    vitest_pass 1d
  fi
done
printf 'Reaplicação 1e OK; clone permanece 1a+1b+1c+1d+1e\n'

#!/usr/bin/env bash
# Fase 2b: ensaio up/down/up da migration 2b com suítes SQL e fingerprint estrutural.
# Alvo: TARGET=clone (container local adm-mt-clone, padrão) ou TARGET=homolog (adm-max-homolog,
# ref qvhyepwduhlgqwpgmpvh, via HOMOLOG_PSQL = script psql que recusa outro projeto). Nunca produção.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TARGET="${TARGET:-clone}"
case "$TARGET" in
  clone) PSQL=(bash "$HERE/lpsql.sh");;
  homolog)
    [[ -n "${HOMOLOG_PSQL:-}" ]] || { printf 'Defina HOMOLOG_PSQL\n' >&2; exit 1; }
    PSQL=(bash "$HOMOLOG_PSQL");;
  *) printf 'TARGET inválido\n' >&2; exit 1;;
esac
UP="$HERE/migrations/20260928060000_mt_fase2b_cadastro_imobiliarias.sql"
DOWN="$HERE/migrations/20260928060000_mt_fase2b_cadastro_imobiliarias.down.sql"
[[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_1e_function_backup') IS NOT NULL")" == "t" ]] \
  || { printf 'Alvo deve ter 1a–1e\n' >&2; exit 1; }
if [[ "$("${PSQL[@]}" -At -c "SELECT to_regprocedure('public.mt_2b_org_auth_users(uuid)') IS NOT NULL")" == "t" ]]; then
  "${PSQL[@]}" < "$DOWN"; printf 'Alvo tinha 2b: down aplicado antes do ensaio\n'
fi
FP0="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
ORGS0="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.organizations")"
suites() { for s in "$@"; do "${PSQL[@]}" -At < "$HERE/tests/isolation_${s}.sql" | grep -E '^(TOTAL=|FALHA)' | sed "s/^/[$s] /"; done; }
for pass in 1 2; do
  "${PSQL[@]}" < "$UP"
  suites 1e 2b
  if [[ "$pass" == "1" ]]; then
    "${PSQL[@]}" < "$DOWN"
    FP2="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
    ORGS2="$("${PSQL[@]}" -At -c "SELECT count(*) FROM public.organizations")"
    [[ "$FP0" == "$FP2" && "$ORGS0" == "$ORGS2" ]] || { printf 'Rollback 2b divergente\n' >&2; exit 1; }
    printf 'Rollback 2b idêntico: %s; organizações: %s\n' "${FP2:0:8}" "$ORGS2"
    suites 1e | sed 's/^/[sem 2b] /'
  fi
done
printf 'Reaplicação 2b OK (%s)\n' "$TARGET"

#!/usr/bin/env bash
# Fase 2e: ensaio up/down/up da migration 2e (permissões por perfil: team_leader = gestor em reservas
# e vínculos; excluir venda só em rascunho) com suítes SQL e fingerprint. Alvo: TARGET=clone
# (container local adm-mt-clone, padrão) ou TARGET=homolog (adm-max-homolog, ref qvhyepwduhlgqwpgmpvh,
# via HOMOLOG_PSQL = script psql que recusa outro projeto). Nunca produção.
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
UP="$HERE/migrations/20260928090000_mt_fase2e_permissoes_perfis.sql"
DOWN="$HERE/migrations/20260928090000_mt_fase2e_permissoes_perfis.down.sql"
[[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_2d_function_backup') IS NOT NULL")" == "t" ]] \
  || { printf 'Alvo deve ter 1a–2d\n' >&2; exit 1; }
if [[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_2e_backup') IS NOT NULL")" == "t" ]]; then
  "${PSQL[@]}" < "$DOWN"; printf 'Alvo tinha 2e: down aplicado antes do ensaio\n'
fi
FP0="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
suites() { for s in "$@"; do "${PSQL[@]}" -At < "$HERE/tests/isolation_${s}.sql" | grep -E '^(TOTAL=|FALHA)' | sed "s/^/[$s] /"; done; }
suites 2e | sed 's/^/[sem 2e] /'
for pass in 1 2; do
  "${PSQL[@]}" < "$UP"
  suites 1a 1b 1e 2b 2c 2d 2e
  if [[ "$pass" == "1" ]]; then
    "${PSQL[@]}" < "$DOWN"
    FP2="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
    [[ "$FP0" == "$FP2" ]] || { printf 'Rollback 2e divergente\n' >&2; exit 1; }
    printf 'Rollback 2e idêntico: %s\n' "${FP2:0:8}"
  fi
done
# Levantamento de quem cancela venda hoje (sem asserção).
"${PSQL[@]}" -At < "$HERE/tests/isolation_2e.sql" | grep -E '^CANCEL:' || true
printf 'Reaplicação 2e OK (%s)\n' "$TARGET"

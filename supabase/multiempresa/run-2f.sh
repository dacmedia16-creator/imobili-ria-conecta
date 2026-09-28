#!/usr/bin/env bash
# Fase 2f: ensaio up/down/up da migration 2f (excluir venda só em rascunho pelo criador/liderança da
# equipe/admin/super_admin da agência; cancelar só pelo dono da plataforma, com auditoria) com suítes
# SQL e fingerprint. Alvo: TARGET=clone (container local adm-mt-clone, padrão) ou TARGET=homolog
# (adm-max-homolog, ref qvhyepwduhlgqwpgmpvh, via HOMOLOG_PSQL = script psql que recusa outro
# projeto). Nunca produção.
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
UP="$HERE/migrations/20260928100000_mt_fase2f_excluir_cancelar_venda.sql"
DOWN="$HERE/migrations/20260928100000_mt_fase2f_excluir_cancelar_venda.down.sql"
[[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_2e_backup') IS NOT NULL")" == "t" ]] \
  || { printf 'Alvo deve ter 1a–2e\n' >&2; exit 1; }
if [[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_2f_backup') IS NOT NULL")" == "t" ]]; then
  "${PSQL[@]}" < "$DOWN"; printf 'Alvo tinha 2f: down aplicado antes do ensaio\n'
fi
FP0="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
suites() { for s in "$@"; do "${PSQL[@]}" -At < "$HERE/tests/isolation_${s}.sql" | grep -E '^(TOTAL=|FALHA)' | sed "s/^/[$s] /"; done; }
suites 2f | grep -E 'TOTAL=' | sed 's/^/[sem 2f] /'
for pass in 1 2; do
  "${PSQL[@]}" < "$UP"
  suites 1a 1b 1e 2b 2c 2d 2e 2f
  if [[ "$pass" == "1" ]]; then
    "${PSQL[@]}" < "$DOWN"
    FP2="$("${PSQL[@]}" -At < "$HERE/fingerprint.sql")"
    [[ "$FP0" == "$FP2" ]] || { printf 'Rollback 2f divergente\n' >&2; exit 1; }
    printf 'Rollback 2f idêntico: %s\n' "${FP2:0:8}"
  fi
done
printf 'Reaplicação 2f OK (%s)\n' "$TARGET"

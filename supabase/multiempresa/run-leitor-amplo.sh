#!/usr/bin/env bash
# 20261002000004 (leitor amplo, RLS rápida): antes(painéis+bench+fingerprint) -> up -> depois ->
# down -> fingerprint igual -> up -> painéis. Nunca produção.
# Alvo: CONTAINER=<container local> (padrão adm-pc-ctx, cópia de produção com 02/03) ou
#       HOMOLOG_PSQL=<script psql que recusa outra ref que não qvhyepwduhlgqwpgmpvh>.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [[ -n "${HOMOLOG_PSQL:-}" ]]; then PSQL=(bash "$HOMOLOG_PSQL")
else export CONTAINER="${CONTAINER:-adm-pc-ctx}"; PSQL=(bash "$HERE/lpsql.sh"); fi
UP="$HERE/migrations/20261002000004_mt_leitor_amplo_rls_rapida.sql"
DOWN="$HERE/migrations/20261002000004_mt_leitor_amplo_rls_rapida.down.sql"
OUT="${OUT:-$(mktemp -d)}"; mkdir -p "$OUT"; REPS="${REPS:-3}"
pain() { "${PSQL[@]}" -At < "$HERE/tests/paineis_resumo.sql" | grep '^PAINEL '; }
bench() { "${PSQL[@]}" -At -v reps="$REPS" < "$HERE/tests/bench_dashboard.sql" | grep '^BENCH '; }
fp() { "${PSQL[@]}" -At < "$HERE/fingerprint.sql"; }
npol() { "${PSQL[@]}" -At -c "SELECT count(*) FROM pg_policies WHERE policyname='zz_mt_leitor_amplo_select'"; }
if [[ "$(npol)" != "0" ]]; then "${PSQL[@]}" < "$DOWN"; echo "alvo tinha a 0004: down aplicado"; fi
FP0="$(fp)"; pain > "$OUT/pain_antes.txt"; bench > "$OUT/bench_antes.txt"
"${PSQL[@]}" < "$UP"; echo "up: $(npol) policies"
pain > "$OUT/pain_depois.txt"; bench > "$OUT/bench_depois.txt"
cmp_p() {
  if diff -q "$1" "$2" >/dev/null; then echo "paineis identicos ($(wc -l < "$2") linhas)"
  else echo "PAINEIS DIVERGENTES"; diff "$1" "$2" | head -20; exit 1; fi
}
cmp_p "$OUT/pain_antes.txt" "$OUT/pain_depois.txt"
"${PSQL[@]}" < "$DOWN"
FP1="$(fp)"; [[ "$FP0" == "$FP1" ]] || { echo "ROLLBACK DIVERGENTE"; exit 1; }
echo "rollback identico: ${FP1:0:12} (policies=$(npol))"
"${PSQL[@]}" < "$UP"; pain > "$OUT/pain_reup.txt"; cmp_p "$OUT/pain_antes.txt" "$OUT/pain_reup.txt"
echo "reaplicacao ok ($(npol) policies)"
echo "--- bench antes"; cat "$OUT/bench_antes.txt"; echo "--- bench depois"; cat "$OUT/bench_depois.txt"
echo "OUT=$OUT"

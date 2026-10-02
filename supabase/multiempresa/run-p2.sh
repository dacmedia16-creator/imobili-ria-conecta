#!/usr/bin/env bash
# P2 (índices + RLS TO authenticated/(select auth.uid())): ensaio na cópia local.
# antes(matriz+bench+fingerprint) -> up -> depois -> down -> fingerprint igual -> up -> matriz.
# CONTAINER=adm-pc-ctx (padrão; cópia de produção com 20261002000002). Nunca remoto.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export CONTAINER="${CONTAINER:-adm-pc-ctx}"
PSQL=(bash "$HERE/lpsql.sh")
UP="$HERE/migrations/20261002000003_mt_p2_indices_rls_authenticated.sql"
DOWN="$HERE/migrations/20261002000003_mt_p2_indices_rls_authenticated.down.sql"
OUT="${OUT:-$(mktemp -d)}"
vis() { "${PSQL[@]}" -At < "$HERE/tests/visibilidade_p2.sql"; }
bench() { "${PSQL[@]}" -At < "$HERE/tests/bench_p2.sql"; }
fp() { "${PSQL[@]}" -At < "$HERE/fingerprint.sql"; }
if [[ "$("${PSQL[@]}" -At -c "SELECT to_regclass('public.mt_p2_backup') IS NOT NULL")" == "t" ]]; then
  "${PSQL[@]}" < "$DOWN"; echo "alvo tinha P2: down aplicado"
fi
FP0="$(fp)"; vis > "$OUT/vis_antes.txt"; bench > "$OUT/bench_antes.txt"
"${PSQL[@]}" < "$UP"
vis > "$OUT/vis_depois.txt"; bench > "$OUT/bench_depois.txt"
# Autenticados: idêntico. Anônimo: antes 42501 em clientes/metas (avaliava a policy), depois 0 linhas
# (a policy nem roda). Em ambos o anônimo não pode ver nem alterar nenhuma linha.
auth_only() { grep '^VIS ' "$1" | grep -v '^VIS anon '; }
cmp_vis() {
  if diff -q <(auth_only "$1") <(auth_only "$2") >/dev/null; then
    echo "matriz autenticados identica ($(auth_only "$2" | wc -l) linhas)"
  else echo "MATRIZ DIVERGENTE"; diff <(auth_only "$1") <(auth_only "$2") | head -20; exit 1; fi
  if grep '^VIS anon ' "$2" | grep -Eq ' n=[1-9]'; then echo "ANON VE/ALTERA LINHAS"; exit 1; fi
  echo "anon: 0 linhas em todas as tabelas"
}
cmp_vis "$OUT/vis_antes.txt" "$OUT/vis_depois.txt"
"${PSQL[@]}" < "$DOWN"
FP1="$(fp)"; [[ "$FP0" == "$FP1" ]] || { echo "ROLLBACK DIVERGENTE"; exit 1; }
echo "rollback identico: ${FP1:0:8}"
"${PSQL[@]}" < "$UP"
vis > "$OUT/vis_reup.txt"; cmp_vis "$OUT/vis_antes.txt" "$OUT/vis_reup.txt"; echo "reaplicacao ok"
echo "--- bench antes"; cat "$OUT/bench_antes.txt"; echo "--- bench depois"; cat "$OUT/bench_depois.txt"
echo "OUT=$OUT"

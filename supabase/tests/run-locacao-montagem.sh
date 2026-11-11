#!/usr/bin/env bash
# Homologação/clone: aplica migrations necessárias e a nova em uma transação revertida.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/supabase/tests"
PGCONN="${PGCONN:?defina conexão de homologação, nunca produção}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
for base in locacoes locacao_contratos locacao_contrato_dados locacao_montagem; do
  case "$base" in
    locacoes) f=20261110120000_locacao_fase1;;
    locacao_contratos) f=20261111120000_locacao_fase2_financeiro;;
    locacao_contrato_dados) f=20261112120000_locacao_documentos_ia;;
    locacao_montagem) f=20261114120000_locacao_montar_contrato;;
  esac
  exists=$(psql "$PGCONN" -X -At -c "SELECT to_regclass('public.$base') IS NOT NULL")
  if [ "$exists" = t ]; then paths+=(""); else paths+=("$f"); fi
done
ficha_exists=$(psql "$PGCONN" -X -At -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='locacoes' AND column_name='docs_completos_em')")
OUT="${HERMES_KANBAN_WORKSPACE:-$ROOT}/montagem-teste.out"
{
  echo 'BEGIN;'
  for f in "${paths[@]:0:3}"; do [ -z "$f" ] || strip "$ROOT/supabase/migrations/$f.sql"; done
  [ "$ficha_exists" = t ] || strip "$ROOT/supabase/migrations/20261113120000_locacao_ficha_checklist.sql"
  [ -z "${paths[3]}" ] || strip "$ROOT/supabase/migrations/${paths[3]}.sql"
  # Setup da suíte da ficha até a etapa de minuta, com tudo fictício.
  sed -n '1,207p' "$HERE/locacao-ficha.sql"
  strip "$HERE/locacao-montagem.sql"
  echo 'RESET ROLE;'
  echo 'ROLLBACK;'
} | psql "$PGCONN" -X -q -At -b -v ON_ERROR_STOP=1 > "$OUT" 2>&1 || {
  grep -E 'ERROR|LINE|CONTEXT|FALHA|TOTAL=' "$OUT" || true
  exit 1
}
grep -E '^(TOTAL=|[^[:space:]].*FALHA)' "$OUT" || true

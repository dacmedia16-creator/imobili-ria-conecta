#!/usr/bin/env bash
# "Diário da equipe: gestor vê só a própria equipe" (migration 20261218130000, t_0fe0f09f) numa ÚNICA transação revertida:
# [aplica 20261119120000 e 20261218120000] -> hash -> migration -> suíte -> rollback -> hash igual -> reaplica -> ROLLBACK.
# Nada fica gravado. Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-diario-equipe-gestor-so-equipe.sh  (nunca produção)
# Controle negativo (teste do erro): SEM_MIGRATION=1 roda a suíte sem a migration nova e TEM de dar FALHAS.
# Sai com código 1 se houver FALHA.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
PRE1="$ROOT/supabase/migrations/20261119120000_meu_plano_2027_pdf_lider.sql"
PRE2="$ROOT/supabase/migrations/20261218120000_meu_plano_gestor_so_equipe.sql"
MIG="$ROOT/supabase/migrations/20261218130000_diario_equipe_gestor_so_equipe.sql"
RB="$ROOT/supabase/rollback/20261218130000_diario_equipe_gestor_so_equipe.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,'') x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
     AND p.proname LIKE ANY (ARRAY['carreira_diario%','carreira_plano%','meu_plano%'])) s),''));"
OUT="$(
{
  echo "BEGIN;"
  strip "$PRE1"   # idempotentes; a homologação pode ainda não ter
  strip "$PRE2"
  echo "\\echo [pre-requisitos ok]"
  echo "$HASH"
  if [[ "${SEM_MIGRATION:-}" == "1" ]]; then
    echo "\\echo [CONTROLE NEGATIVO: sem a migration 20261218130000]"
  else
    strip "$MIG"
    echo "\\echo [migration ok]"
  fi
  echo "SAVEPOINT s1;"
  echo "\\echo [suite diario_equipe_gestor_so_equipe]"
  strip "$HERE/diario_equipe_gestor_so_equipe.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  if [[ "${SEM_MIGRATION:-}" != "1" ]]; then
    strip "$RB"
    echo "\\echo [rollback ok]"
    echo "$HASH"
    strip "$MIG"
    echo "\\echo [reaplicada ok]"
  fi
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
)"
echo "$OUT"
if echo "$OUT" | grep -qE "^FALHA|ERROR|psql:"; then exit 1; fi
echo "$OUT" | grep -q "^TOTAL=" || exit 1

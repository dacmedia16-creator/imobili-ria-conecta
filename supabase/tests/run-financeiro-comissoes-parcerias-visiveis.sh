#!/usr/bin/env bash
# RPC financeiro_comissoes_parcerias_visiveis (migration 20270106120000, t_205ec8f5) numa ÚNICA
# transação revertida: migration -> suíte (RPC = RLS para todo usuário ativo + travas) -> rollback
# -> função some -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-financeiro-comissoes-parcerias-visiveis.sh  (nunca produção)
# Controle negativo: SEM_MIGRATION=1 roda a suíte sem a migration e TEM de falhar (função inexistente).
# Sai com código 1 se houver FALHA.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20270106120000_financeiro_comissoes_parcerias_visiveis.sql"
RB="$ROOT/docs/sql/rollback/20270106120000_financeiro_comissoes_parcerias_visiveis.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
set +e
OUT="$(
{
  echo "\\set ON_ERROR_STOP 1"
  echo "BEGIN;"
  # A homologação não tem eh_so_locacao (produção tem, migration 20261122120100): cria só nesta
  # transação, com o mesmo corpo de produção, se faltar.
  cat <<'SQL'
DO $pre$ BEGIN
  IF to_regprocedure('public.eh_so_locacao(uuid)') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION public.eh_so_locacao(_uid uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $b$
      SELECT _uid IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role::text = 'locacao')
         AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role::text NOT IN ('locacao', 'fotografo'))
      $b$$f$;
    RAISE NOTICE '[pre] eh_so_locacao criada só nesta transação';
  END IF;
END $pre$;
SQL
  if [[ "${SEM_MIGRATION:-}" == "1" ]]; then
    echo "\\echo [CONTROLE NEGATIVO: sem a migration 20270106120000]"
  else
    strip "$MIG"
    echo "\\echo [migration ok]"
  fi
  echo "SAVEPOINT s1;"
  strip "$HERE/financeiro_comissoes_parcerias_visiveis.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  if [[ "${SEM_MIGRATION:-}" != "1" ]]; then
    strip "$RB"
    echo "SELECT CASE WHEN to_regprocedure('public.financeiro_comissoes_parcerias_visiveis()') IS NULL
                 THEN 'OK: rollback remove a função' ELSE 'FALHA: rollback não removeu' END;"
  fi
  echo "ROLLBACK;"
} | $PSQL 2>&1
)"
RC=$?
set -e
echo "$OUT"
if [[ $RC -ne 0 ]] || grep -q "FALHA" <<<"$OUT"; then
  echo "RESULTADO: FALHA"
  exit 1
fi
echo "RESULTADO: OK ($(grep -c 'OK: ' <<<"$OUT" || true) verificações OK)"

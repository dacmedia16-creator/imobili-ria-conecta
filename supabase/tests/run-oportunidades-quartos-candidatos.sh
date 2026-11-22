#!/usr/bin/env bash
# Migration 20261221120000 (quartos na RPC opportunity_capture_candidates, t_b832cf00) numa ÚNICA transação revertida:
# md5 antes -> migration -> suíte de acesso antiga + complemento de quartos -> rollback -> md5 igual ao de antes -> ROLLBACK.
# Nada fica gravado. Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-oportunidades-quartos-candidatos.sh  (nunca produção)
# Controle negativo (teste do erro): SEM_MIGRATION=1 roda sem a migration e TEM de falhar (RPC sem a coluna quartos).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261221120000_oportunidades_quartos_candidatos.sql"
RB="$ROOT/supabase/rollback/20261221120000_oportunidades_quartos_candidatos.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'fp: ' || md5(p.prosrc || pg_get_function_result(p.oid) || coalesce(p.proacl::text, '') || p.prosecdef::text)
  FROM pg_proc p WHERE p.oid = 'public.opportunity_capture_candidates()'::regprocedure;"
{
  echo "BEGIN;"
  echo "$FP"
  if [[ "${SEM_MIGRATION:-}" == "1" ]]; then
    echo "\\echo [CONTROLE NEGATIVO: sem a migration 20261221120000]"
  else
    strip "$MIG"
    echo "\\echo [migration ok]"
  fi
  echo "SAVEPOINT s1;"
  strip "$HERE/oportunidades_encaixe_envolvidos.sql"
  strip "$HERE/oportunidades_quartos_candidatos.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  if [[ "${SEM_MIGRATION:-}" != "1" ]]; then
    strip "$RB"
    echo "\\echo [rollback ok: fp abaixo tem de ser igual ao primeiro]"
    echo "$FP"
  fi
  echo "ROLLBACK;"
} | $PSQL 2>&1

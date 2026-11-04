#!/usr/bin/env bash
# Comissão editada em "análise do Financeiro" (migration 20261104160000, t_59cb12e0) numa ÚNICA transação
# revertida: suíte SEM a migration (deve falhar nos casos novos) -> migration -> suíte (100%) -> rollback ->
# confere hashes iguais aos de antes -> reaplica. Nada fica gravado.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-comissao-analise-financeiro.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
MIG="$ROOT/supabase/migrations/20261104160000_comissao_analise_financeiro_sync.sql"
RB="$ROOT/docs/sql/rollback/20261104160000_comissao_analise_financeiro_sync.rollback.sql"
SUITE="$HERE/comissao_analise_financeiro.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || coalesce(string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)) || '/' || pg_get_userbyid(p.proowner) || '/' || coalesce(array_to_string(p.proacl, ','), ''), ' ' ORDER BY p.oid::regprocedure::text), '') FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('sincronizar_ocorrencia_antes_financeiro','trg_sincronizar_financeiro_ocorrencia_da_venda','sync_occurrence_commissions','sincronizar_comissao_ocorrencia_em_analise');"
{
  echo "BEGIN;"
  echo "\\echo [antes]"
  echo "$HASH"
  echo "SAVEPOINT s0;"
  echo "\\echo [suite SEM a migration — casos novos devem falhar]"
  # A suíte checa a função nova; sem a migration ela ainda não existe -> cria um stub só aqui.
  echo "CREATE FUNCTION public.sincronizar_comissao_ocorrencia_em_analise(uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS 'SELECT NULL::void';"
  echo "REVOKE ALL ON FUNCTION public.sincronizar_comissao_ocorrencia_em_analise(uuid) FROM PUBLIC, anon, authenticated;"
  strip "$SUITE"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s0;"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "$HASH"
  echo "SAVEPOINT s1;"
  echo "\\echo [suite COM a migration]"
  strip "$SUITE"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$HASH"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

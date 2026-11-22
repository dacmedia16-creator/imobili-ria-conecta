#!/usr/bin/env bash
# "Gestor só na própria equipe" (migrations 20261219120000 + 20261219130000, t_82b66d41) numa ÚNICA transação revertida:
# [pré-requisitos idempotentes] -> hash -> migrations -> suíte -> rollbacks -> hash igual -> reaplica -> ROLLBACK.
# Nada fica gravado. Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-gestor-so-equipe-metas-pacto-1a1.sh  (nunca produção)
# Controle negativo (teste do erro): SEM_MIGRATION=1 roda a suíte sem as migrations novas e TEM de dar FALHAS.
# Sai com código 1 se houver FALHA.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
M="$ROOT/supabase/migrations"
# A homologação pode não ter as migrations de nov/dez: todas são CREATE OR REPLACE / IF NOT EXISTS, só nesta transação.
PRE=(
  "$M/20261119120000_meu_plano_2027_pdf_lider.sql"
  "$M/20261207120000_metas_2027_painel_gestor.sql"
  "$M/20261208120000_metas_2027_painel_imobiliaria.sql"
  "$M/20261209120000_meu_plano_trava_valores.sql"
  "$M/20261209130000_meu_plano_reabrir.sql"
  "$M/20261209140000_meu_plano_trava_assinado.sql"
  "$M/20261218120000_meu_plano_gestor_so_equipe.sql"
)
MIG1="$M/20261219120000_gestor_so_equipe_metas_pacto_1a1.sql"
MIG2="$M/20261219130000_metas_imobiliaria_so_admin.sql"
RB1="$ROOT/supabase/rollback/20261219120000_gestor_so_equipe_metas_pacto_1a1.sql"
RB2="$ROOT/supabase/rollback/20261219130000_metas_imobiliaria_so_admin.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
HASH="SELECT 'hash: ' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proconfig::text,'')||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,'') x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
     AND p.proname LIKE ANY (ARRAY['metas_%','carreira_plano%','meu_plano%','gestao_%'])
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||coalesce(with_check,'')) FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('carreira_plano','gestao_conversas_1a1','metas_direcao')) s),''));"
# md5 das funções tocadas ANTES da migration (deve bater com produção; o rollback devolve exatamente isto).
MD5S="SELECT 'md5 '||p.proname||' '||md5(p.prosrc) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  AND p.proname IN ('metas_equipe_broker','metas_equipe_times','carreira_plano_assinar_broker','carreira_plano_reabrir',
                    'gestao_pode_ver','gestao_farol_dados','metas_comissao_quebra','metas_imobiliaria_estoque') ORDER BY 1;"
OUT="$(
{
  echo "BEGIN;"
  echo "SELECT (to_regprocedure('public.eh_so_locacao(uuid)') IS NULL) AS need_loc \\gset"
  echo "\\if :need_loc"
  echo "CREATE FUNCTION public.eh_so_locacao(uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';"
  echo "GRANT EXECUTE ON FUNCTION public.eh_so_locacao(uuid) TO authenticated;"
  echo "\\endif"
  for f in "${PRE[@]}"; do strip "$f"; done
  echo "\\echo [pre-requisitos ok]"
  echo "$MD5S"
  echo "$HASH"
  if [[ "${SEM_MIGRATION:-}" == "1" ]]; then
    echo "\\echo [CONTROLE NEGATIVO: sem as migrations 20261219120000 e 20261219130000]"
  else
    strip "$MIG1"; strip "$MIG2"
    echo "\\echo [migrations ok]"
  fi
  echo "SAVEPOINT s1;"
  echo "\\echo [suite gestor_so_equipe_metas_pacto_1a1]"
  strip "$HERE/gestor_so_equipe_metas_pacto_1a1.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  if [[ "${SEM_MIGRATION:-}" != "1" ]]; then
    strip "$RB2"; strip "$RB1"
    echo "\\echo [rollback ok]"
    echo "$HASH"
    strip "$MIG1"; strip "$MIG2"
    echo "\\echo [reaplicada ok]"
  fi
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|hash|md5)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
)"
echo "$OUT"
if echo "$OUT" | grep -qE "^FALHA|ERROR|psql:"; then exit 1; fi
echo "$OUT" | grep -q "^TOTAL=" || exit 1

#!/usr/bin/env bash
# Líder sem equipe vigente no painel Metas 2027 · Equipes (migration 20261231120000, t_a897136b) numa ÚNICA
# transação revertida: [pré-requisitos idempotentes] -> fingerprint -> migration -> suíte -> rollback ->
# fingerprint igual -> reaplica 2x -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="bash <hq.sh> -" bash supabase/tests/run-metas-lider-sem-equipe.sh  (homologação; nunca produção)
# Controle negativo (teste do erro): SEM_MIGRATION=1 roda a suíte sem a migration nova e TEM de dar FALHAS.
# Sai com código 1 se houver FALHA.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
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
  "$M/20261219120000_gestor_so_equipe_metas_pacto_1a1.sql"
)
MIG="$M/20261231120000_metas_lider_sem_equipe.sql"
RB="$ROOT/supabase/rollback/20261231120000_metas_lider_sem_equipe.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proconfig::text,'')||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace) s),''));"
MD5="SELECT 'md5 metas_equipe_escopo ' || md5(prosrc) FROM pg_proc WHERE oid = 'public.metas_equipe_escopo(uuid)'::regprocedure;"
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
  echo "$MD5"
  echo "$FP"
  if [[ "${SEM_MIGRATION:-}" == "1" ]]; then
    echo "\\echo [CONTROLE NEGATIVO: sem a migration 20261231120000]"
  else
    strip "$MIG"
    echo "\\echo [migration ok]"
  fi
  echo "SAVEPOINT s1;"
  echo "\\echo [suite metas_lider_sem_equipe]"
  strip "$HERE/metas_lider_sem_equipe.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT s1;"
  if [[ "${SEM_MIGRATION:-}" != "1" ]]; then
    strip "$RB"
    echo "\\echo [rollback ok]"
    echo "$MD5"
    echo "$FP"
    strip "$MIG"; strip "$MIG"
    echo "\\echo [reaplicada 2x ok]"
  fi
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=|md5)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true
)"
echo "$OUT"
if echo "$OUT" | grep -qE "^FALHA|ERROR|psql:"; then exit 1; fi
echo "$OUT" | grep -q "^TOTAL=" || exit 1

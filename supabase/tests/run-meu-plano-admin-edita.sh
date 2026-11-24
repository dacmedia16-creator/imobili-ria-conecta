#!/usr/bin/env bash
# Administrador abre/edita o plano de outra pessoa (migration 20270101120000, t_c9b0f633) numa ÚNICA transação
# revertida (homologação ou banco descartável, NUNCA produção): pré-requisitos que faltarem -> fingerprint A -> up
# -> suíte -> rollback -> fingerprint == A -> reaplica 2x -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-meu-plano-admin-edita.sh
#      MIG=<outro arquivo> para o controle negativo (a suíte tem de falhar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
V=20270101120000
MIG="${MIG:-$ROOT/supabase/migrations/${V}_meu_plano_admin_edita.sql}"
RB="$ROOT/docs/sql/rollback/${V}_meu_plano_admin_edita.rollback.sql"
M="$ROOT/supabase/migrations"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||coalesce(md5(qual),'')||':'||coalesce(md5(with_check),'') FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal) s),''));"
pre() { # $1 = função que prova a migration; $2.. = arquivos
  local f="$1"; shift
  echo "SELECT (to_regprocedure('$f') IS NULL) AS need \\gset"
  echo "\\if :need"
  for a in "$@"; do strip "$a"; done
  echo "\\endif"
}
OUT="$({
  echo "BEGIN;"
  # Pré-requisitos que a homologação pode não ter (produção tem todos desde 23/11).
  pre 'public.meu_plano_lider_ve(uuid)' "$M/20261119120000_meu_plano_2027_pdf_lider.sql"
  pre 'public.carreira_plano_trava(jsonb)' "$M/20261209120000_meu_plano_trava_valores.sql"
  pre 'public.carreira_plano_reabrir(uuid,integer,text)' "$M/20261209130000_meu_plano_reabrir.sql"
  pre 'public.carreira_plano_trava_assinado()' "$M/20261209140000_meu_plano_trava_assinado.sql" "$M/20261227120000_meu_plano_trava_assinado_409.sql"
  pre 'public.carreira_plano_falta_meta(jsonb)' "$M/20261228120000_meu_plano_assinar_exige_meta.sql"
  # meu_plano_ve_imobiliaria com a org do papel (produção, 20261220120000): só o CREATE da função.
  echo "SELECT coalesce((SELECT prosrc NOT LIKE '%mt_pc_in_context%' FROM pg_proc WHERE proname = 'meu_plano_ve_imobiliaria'), true) AS need \\gset"
  echo "\\if :need"
  sed -n '/^CREATE OR REPLACE FUNCTION public.meu_plano_ve_imobiliaria/,/^\$function\$;/p' "$M/20261220120000_brechas_ve_imobiliaria_farol_sem_equipe.sql"
  echo "\\endif"
  echo "\\echo [pre-requisitos ok]"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/meu_plano_admin_edita.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  strip "$MIG"
  echo "\\echo [reaplicada 2x ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true)"
echo "$OUT"
FPS="$(echo "$OUT" | grep -c '^FP=' || true)"
UNICOS="$(echo "$OUT" | grep '^FP=' | sort -u | wc -l)"
[ "$FPS" = 2 ] && [ "$UNICOS" = 1 ] && echo "[fingerprint antes == depois do rollback]" || { echo "[FINGERPRINT DIVERGE]"; exit 1; }
echo "$OUT" | grep -q 'FALHAS=0' || exit 1
echo "$OUT" | grep -qE 'ERROR|FALHA ' && exit 1
exit 0

#!/usr/bin/env bash
# Plano assinado só leitura (migration 20261209140000, t_850a0d39) numa ÚNICA transação revertida
# (homologação ou banco descartável, NUNCA produção): pré-requisitos (20261119120000 se faltar, 20261209120000 e
# 20261209130000) -> fingerprint A -> up -> fingerprint B -> up 20261227120000 (recusa PT409 = HTTP 409, t_359e9e2a)
# -> suíte -> rollback 409 -> fingerprint == B -> rollback -> fingerprint == A -> reaplica 2x -> ROLLBACK.
# Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-meu-plano-trava-assinado.sh
#      MIG=<outro arquivo> ou MIG409=<outro arquivo> para o controle negativo (a suíte tem de falhar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
V=20261209140000
MIG="${MIG:-$ROOT/supabase/migrations/${V}_meu_plano_trava_assinado.sql}"
RB="$ROOT/docs/sql/rollback/${V}_meu_plano_trava_assinado.rollback.sql"
V409=20261227120000
MIG409="${MIG409:-$ROOT/supabase/migrations/${V409}_meu_plano_trava_assinado_409.sql}"
RB409="$ROOT/docs/sql/rollback/${V409}_meu_plano_trava_assinado_409.rollback.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||coalesce(md5(qual),'')||':'||coalesce(md5(with_check),'') FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal) s),''));"
{
  echo "BEGIN;"
  echo "SELECT (to_regprocedure('public.meu_plano_lider_ve(uuid)') IS NULL) AS need_tl \\gset"
  echo "\\if :need_tl"
  strip "$ROOT/supabase/migrations/20261119120000_meu_plano_2027_pdf_lider.sql"
  echo "\\endif"
  echo "SELECT (to_regprocedure('public.carreira_plano_trava(jsonb)') IS NULL) AS need_tv \\gset"
  echo "\\if :need_tv"
  strip "$ROOT/supabase/migrations/20261209120000_meu_plano_trava_valores.sql"
  echo "\\endif"
  echo "SELECT (to_regprocedure('public.carreira_plano_reabrir(uuid,integer,text)') IS NULL) AS need_rb \\gset"
  echo "\\if :need_rb"
  strip "$ROOT/supabase/migrations/20261209130000_meu_plano_reabrir.sql"
  echo "\\endif"
  echo "\\echo [pre-requisitos ok]"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "$FP"
  strip "$MIG409"
  echo "\\echo [migration 409 ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/meu_plano_trava_assinado.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB409"
  echo "\\echo [rollback 409 ok]"
  echo "$FP"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  strip "$MIG409"
  strip "$MIG"
  strip "$MIG409"
  echo "\\echo [reaplicada 2x ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

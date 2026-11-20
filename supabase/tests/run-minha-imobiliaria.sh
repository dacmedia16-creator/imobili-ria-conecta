#!/usr/bin/env bash
# Minha imobiliária (migration 20261210120000, t_f7f1b3e4) numa ÚNICA transação revertida (homologação ou banco
# descartável, NUNCA produção): pré-requisitos -> fingerprint A -> up -> suíte -> rollback -> fingerprint == A ->
# reaplica 2x (idempotência) -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-minha-imobiliaria.sh
#      MIG=<outra migration> para o controle negativo (a suíte tem de falhar).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
V=20261210120000
MIG="${MIG:-$ROOT/supabase/migrations/${V}_minha_imobiliaria.sql}"
RB="$ROOT/supabase/rollback/${V}_minha_imobiliaria.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relkind::text||':'||coalesce(c.relacl::text,'') FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||'.'||conname FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal) s),''));"
{
  echo "BEGIN;"
  # Pré-requisitos que a homologação pode não ter (produção já tem): só nesta transação.
  echo "SELECT (to_regprocedure('public.eh_so_locacao(uuid)') IS NULL) AS need_loc \\gset"
  echo "\\if :need_loc"
  echo "CREATE FUNCTION public.eh_so_locacao(uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';"
  echo "GRANT EXECUTE ON FUNCTION public.eh_so_locacao(uuid) TO authenticated;"
  echo "\\endif"
  echo "SELECT (to_regprocedure('public.metas_direcao_papel(public.app_role[])') IS NULL) AS need_metas \\gset"
  echo "\\if :need_metas"
  strip "$ROOT/supabase/migrations/20261207120000_metas_2027_painel_gestor.sql"
  strip "$ROOT/supabase/migrations/20261208120000_metas_2027_painel_imobiliaria.sql"
  echo "\\endif"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  strip "$HERE/minha_imobiliaria.sql"
  echo "RESET ROLE;"
  echo "ROLLBACK TO SAVEPOINT suite;"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "$FP"
  strip "$MIG"
  strip "$MIG"
  echo "\\echo [reaplicada 2x ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|FP=)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

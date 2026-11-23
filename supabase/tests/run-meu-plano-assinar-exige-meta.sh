#!/usr/bin/env bash
# Só assina com a meta oficial calculada (migration 20261228120000, t_3d55d20c) numa ÚNICA transação revertida
# (homologação ou banco descartável, NUNCA produção): fingerprint A -> up -> suíte -> rollback ->
# fingerprint == A -> reaplica 2x (idempotência) -> ROLLBACK. Nada fica gravado.
# Uso: PSQL="psql <conninfo da homologação>" bash supabase/tests/run-meu-plano-assinar-exige-meta.sh
#      MIG=<outro arquivo> para o controle negativo (a suíte tem de falhar).
# Sai com código 1 se houver FALHA.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (homologação ou banco descartável; nunca produção)}"
V=20261228120000
MIG="${MIG:-$ROOT/supabase/migrations/${V}_meu_plano_assinar_exige_meta.sql}"
RB="$ROOT/docs/sql/rollback/${V}_meu_plano_assinar_exige_meta.rollback.sql"
CASOS="$ROOT/src/lib/meu-plano-2027/meta-calculavel.casos.json"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
FP="SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'rel:'||c.relname||':'||c.relkind::text FROM pg_class c WHERE c.relnamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||schemaname||'.'||tablename||'.'||policyname FROM pg_policies
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||'.'||tgname FROM pg_trigger WHERE NOT tgisinternal) s),''));"
OUT="$({
  echo "BEGIN;"
  # Pré-requisitos que a homologação pode não ter (produção tem desde 20/11): trava de valores e plano assinado.
  echo "SELECT (to_regprocedure('public.carreira_plano_trava(jsonb)') IS NULL) AS need_trava \\gset"
  echo "\\if :need_trava"
  strip "$ROOT/supabase/migrations/20261209120000_meu_plano_trava_valores.sql"
  echo "\\endif"
  echo "SELECT (to_regprocedure('public.carreira_plano_trava_assinado()') IS NULL) AS need_assinado \\gset"
  echo "\\if :need_assinado"
  strip "$ROOT/supabase/migrations/20261209140000_meu_plano_trava_assinado.sql"
  strip "$ROOT/supabase/migrations/20261227120000_meu_plano_trava_assinado_409.sql"
  echo "\\endif"
  echo "$FP"
  strip "$MIG"
  echo "\\echo [migration ok]"
  echo "SAVEPOINT suite;"
  echo "\\set casos \`cat '$CASOS'\`"
  echo "\\set trava_casos \`cat '$ROOT/src/lib/meu-plano-2027/trava-sugestao.casos.json'\`"
  strip "$HERE/meu_plano_assinar_exige_meta.sql"
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

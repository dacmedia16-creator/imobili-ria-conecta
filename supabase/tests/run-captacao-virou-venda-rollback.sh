#!/usr/bin/env bash
# Ensaio do rollback de 20261008190000 numa ÚNICA transação revertida (homologação/clone, nunca produção):
# aplica a migration, roda o rollback e confere que o banco voltou ao estado anterior.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-captacao-virou-venda-rollback.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1" | grep -v '^\\ir '; }
V2="$ROOT/supabase/migrations/20261008170000_mapa_captacoes_preco_contato.sql"
{
  echo "BEGIN;"
  echo "SELECT to_regprocedure('public.mapa_captacoes_v2()') IS NULL AS need_v2 \\gset"
  echo "\\if :need_v2"
  strip "$V2"
  echo "\\endif"
  echo "CREATE TEMP TABLE antes AS SELECT md5(pg_get_functiondef('public.mapa_captacoes_v2()'::regprocedure)) h,"
  echo "  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'sales') ncol,"
  echo "  (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage') npol;"
  strip "$ROOT/supabase/migrations/20261008190000_captacao_virou_venda.sql"
  echo "\\echo [migration ok]"
  strip "$ROOT/supabase/rollback/20261008190000_captacao_virou_venda.sql"
  strip "$V2"
  echo "\\echo [rollback ok]"
  echo "SELECT CASE WHEN a.h = md5(pg_get_functiondef('public.mapa_captacoes_v2()'::regprocedure)) THEN 'ok ' ELSE 'FALHA ' END || 'mapa_captacoes_v2 idêntica à anterior' FROM antes a;"
  echo "SELECT CASE WHEN a.ncol = (SELECT count(*) FROM information_schema.columns WHERE table_name = 'sales') THEN 'ok ' ELSE 'FALHA ' END || 'sales sem a coluna nova' FROM antes a;"
  echo "SELECT CASE WHEN a.npol = (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage') THEN 'ok ' ELSE 'FALHA ' END || 'policies do storage como antes' FROM antes a;"
  echo "SELECT CASE WHEN to_regprocedure('public.exclusive_virar_venda(uuid)') IS NULL THEN 'ok ' ELSE 'FALHA ' END || 'RPCs novas removidas';"
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA)|ERROR|LINE|DETAIL|psql:" || true

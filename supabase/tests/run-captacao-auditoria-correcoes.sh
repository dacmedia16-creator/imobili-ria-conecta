#!/usr/bin/env bash
# Correções da auditoria da captação (migration 20261008210000) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção). Aplica antes, só na transação, as migrations de captação e de
# Feedback que faltarem no alvo.
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-captacao-auditoria-correcoes.sh [--so-migration]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
M="$ROOT/supabase/migrations"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
cond() { # cond <variavel> <sql booleano> <migration>
  echo "SELECT ($2) AS $1 \\gset"
  echo "\\if :$1"
  strip "$M/$3"
  echo "\\endif"
}
{
  echo "BEGIN;"
  echo "ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS archived_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS archived_by uuid, ADD COLUMN IF NOT EXISTS discarded_at timestamptz,"
  echo "  ADD COLUMN IF NOT EXISTS discarded_by uuid, ADD COLUMN IF NOT EXISTS signed_on date,"
  echo "  ADD COLUMN IF NOT EXISTS geo_lat double precision, ADD COLUMN IF NOT EXISTS geo_lon double precision,"
  echo "  ADD COLUMN IF NOT EXISTS geo_key text;"
  cond need_remax "NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'remax_id')" 20261006100000_profiles_remax_id.sql
  cond need_portal "to_regclass('public.portal_listing_snapshots') IS NULL" 20261006120000_portal_metrics.sql
  cond need_fbmod "NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_modules_module_check' AND pg_get_constraintdef(oid) LIKE '%feedback_proprietario%')" 20261006170000_module_feedback_proprietario.sql
  cond need_fbact "to_regclass('public.owner_feedback_actions') IS NULL" 20261006190000_owner_feedback_actions.sql
  cond need_gestor "NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'exclusive_manager_pending_read')" 20261006210000_exclusividade_contrato_pelo_gestor.sql
  cond need_mapa "to_regprocedure('public.mapa_captacoes()') IS NULL" 20261008150000_vendas_regiao_todos_e_mapa_captacoes.sql
  cond need_manual "to_regprocedure('public.exclusive_create_manual(uuid)') IS NULL" 20261008160000_exclusividade_cadastro_manual.sql
  cond need_v2 "to_regprocedure('public.mapa_captacoes_v2()') IS NULL" 20261008170000_mapa_captacoes_preco_contato.sql
  cond need_vv "to_regprocedure('public.exclusive_venda_ativa(uuid)') IS NULL" 20261008190000_captacao_virou_venda.sql
  echo "\\echo [pre ok]"
  strip "$M/20261008210000_captacao_auditoria_correcoes.sql"
  echo "\\echo [migration ok]"
  if [ "${1:-}" = "--rollback" ]; then
    strip "$ROOT/supabase/rollback/20261008210000_captacao_auditoria_correcoes.sql"
    echo "\\echo [rollback ok]"
    echo "SELECT 'ok rollback: coluna removida' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='exclusive_capture_id');"
    echo "SELECT 'ok rollback: funções novas removidas' WHERE to_regprocedure('public.exclusive_plano_ok(uuid,jsonb)') IS NULL AND to_regprocedure('public.exclusive_history_view(uuid)') IS NULL;"
  elif [ "${1:-}" != "--so-migration" ]; then
    strip "$HERE/captacao_auditoria_correcoes.sql"
  fi
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|INFO)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

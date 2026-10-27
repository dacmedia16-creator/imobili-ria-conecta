#!/usr/bin/env bash
# Lista padrão do Feedback para imobiliária nova (migration 20261027180000) numa ÚNICA transação revertida
# (homologação ou clone, nunca produção).
# Uso: PGCONN="<conninfo da homologação>" bash supabase/tests/run-feedback-lista-padrao-org-nova.sh [--rollback]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
V="20261027180000_feedback_lista_padrao_org_nova.sql"
PGCONN="${PGCONN:?defina PGCONN (homologação ou clone, nunca produção)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
{
  echo "BEGIN;"
  strip "$ROOT/supabase/migrations/$V"
  echo "\\echo [migration ok]"
  if [ "${1:-}" = "--rollback" ]; then
    strip "$ROOT/supabase/rollback/$V"
    echo "\\echo [rollback ok]"
    echo "INSERT INTO public.organizations (id, slug, nome, status) VALUES ('7e570000-0000-4000-8000-0000000000b1','zz-teste-lista-padrao-b1','ZZ Teste B1','ativa');"
    echo "SELECT 'ok rollback: gatilho e funções removidos' WHERE to_regprocedure('public.owner_feedback_lista_padrao_copiar(uuid)') IS NULL"
    echo "  AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_zz_feedback_lista_padrao');"
    echo "SELECT 'ok rollback: org nova volta a nascer sem lista' WHERE NOT EXISTS (SELECT 1 FROM public.owner_feedback_actions WHERE organization_id = '7e570000-0000-4000-8000-0000000000b1');"
  else
    strip "$HERE/feedback_lista_padrao_org_nova.sql"
  fi
  echo "ROLLBACK;"
} | psql "$PGCONN" -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|INFO)|ERROR|LINE|DETAIL|CONTEXT|WARNING|psql:" || true

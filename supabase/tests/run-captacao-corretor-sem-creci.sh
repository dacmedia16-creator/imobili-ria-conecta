#!/usr/bin/env bash
# Captador sem CRECI (migration 20261104130000, t_e75b58c5) numa ÚNICA transação revertida:
# aplica 20261029220000 + a nova -> suíte antiga de testemunhas (não pode quebrar) -> suíte nova ->
# rollback -> suíte antiga de novo (estado anterior íntegro) -> reaplica. Nada fica gravado.
# Nunca usar com produção.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-captacao-corretor-sem-creci.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
BASE="$ROOT/supabase/migrations/20261029220000_captacao_testemunhas_automaticas.sql"
MIG="$ROOT/supabase/migrations/20261104130000_captacao_corretor_sem_creci.sql"
RB="$ROOT/supabase/rollback/20261104130000_captacao_corretor_sem_creci.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
suite() { echo "SAVEPOINT s;"; echo "\\echo [$2]"; strip "$1"; echo "RESET ROLE;"; echo "ROLLBACK TO SAVEPOINT s;"; }
{
  echo "BEGIN;"
  strip "$BASE"
  strip "$MIG"
  echo "\\echo [migration ok]"
  suite "$HERE/clicksign_testemunhas_auto.sql" "suite antiga (com a migration nova)"
  suite "$HERE/captacao_corretor_sem_creci.sql" "suite nova"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "SELECT 'rollback: funcoes_novas=' || count(*) FROM pg_proc WHERE proname IN ('exclusive_contrato_corretor_pessoa','exclusive_testemunha_manual_pessoa','exclusive_contrato_editavel','exclusive_contrato_candidatos','exclusive_contrato_corretor_escolher','exclusive_testemunha_2_manual_salvar');"
  echo "SELECT 'rollback: colunas_novas=' || count(*) FROM information_schema.columns WHERE table_name='exclusive_captures' AND column_name IN ('contrato_corretor_id','testemunha_2_manual');"
  echo "SELECT 'rollback: creci_obrigatorio=' || NOT public.exclusive_required_fields('{}'::jsonb, '11144477735', '');"
  suite "$HERE/clicksign_testemunhas_auto.sql" "suite antiga (depois do rollback)"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

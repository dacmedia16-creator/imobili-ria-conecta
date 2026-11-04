#!/usr/bin/env bash
# CRECI só zeros = sem CRECI (migration 20261104140000, t_77132312) numa ÚNICA transação revertida:
# aplica 20261029220000 + 20261104130000 + a nova -> suíte antiga de testemunhas -> suíte do captador
# sem CRECI (130000) -> suíte nova -> rollback -> suítes antigas de novo (estado da 130000 íntegro) ->
# reaplica. Nada fica gravado. Nunca usar com produção.
# Uso: PSQL="docker exec -i pg-c663 psql -U supabase_admin -d postgres" bash supabase/tests/run-creci-so-zeros.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL="${PSQL:?defina PSQL (banco local descartável ou homologação; nunca produção)}"
M1="$ROOT/supabase/migrations/20261029220000_captacao_testemunhas_automaticas.sql"
M2="$ROOT/supabase/migrations/20261104130000_captacao_corretor_sem_creci.sql"
MIG="$ROOT/supabase/migrations/20261104140000_creci_so_zeros_sem_creci.sql"
RB="$ROOT/supabase/rollback/20261104140000_creci_so_zeros_sem_creci.sql"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
suite() { echo "SAVEPOINT s;"; echo "\\echo [$2]"; strip "$1"; echo "RESET ROLE;"; echo "ROLLBACK TO SAVEPOINT s;"; }
{
  echo "BEGIN;"
  # Só no banco local: o papel dono de exclusive_confirmar_data_assinatura (mt_1b_definer) não tem
  # USAGE em auth aqui (em produção tem; a função já roda lá). Revertido junto com a transação.
  echo "DO \$\$ BEGIN IF to_regrole('mt_1b_definer') IS NOT NULL THEN GRANT USAGE ON SCHEMA auth TO mt_1b_definer; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mt_1b_definer; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO mt_1b_definer; END IF; END \$\$;"
  strip "$M1"
  strip "$M2"
  strip "$MIG"
  echo "\\echo [migration ok]"
  suite "$HERE/clicksign_testemunhas_auto.sql" "suite testemunhas automaticas (com a nova)"
  suite "$HERE/captacao_corretor_sem_creci.sql" "suite captador sem CRECI 130000 (com a nova)"
  suite "$HERE/creci_so_zeros_sem_creci.sql" "suite nova (CRECI so zeros)"
  strip "$RB"
  echo "\\echo [rollback ok]"
  echo "SELECT 'rollback: funcoes_novas=' || count(*) FROM pg_proc WHERE proname IN ('creci_real','exclusive_testemunha_manual_salvar','exclusive_testemunhas_editavel','exclusive_testemunha_digitada','exclusive_testemunha_conflitos','exclusive_captador_proprietario','exclusive_proprietarios_evitar','exclusive_nome_norm','exclusive_tem_assinado_valido');"
  echo "SELECT 'rollback: coluna_t1=' || count(*) FROM information_schema.columns WHERE table_name='exclusive_captures' AND column_name='testemunha_1_manual';"
  echo "SELECT 'rollback: funcoes_sem_creci_real=' || count(*) FROM pg_proc WHERE proname IN ('exclusive_required_fields','exclusive_contrato_corretor_pessoa','exclusive_testemunhas_resolver','exclusive_contrato_editavel') AND prosrc NOT LIKE '%creci_real%';"
  suite "$HERE/clicksign_testemunhas_auto.sql" "suite testemunhas automaticas (depois do rollback)"
  suite "$HERE/captacao_corretor_sem_creci.sql" "suite captador sem CRECI 130000 (depois do rollback)"
  strip "$MIG"
  echo "\\echo [reaplicada ok]"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -E "^\[|^(ok|FALHA|TOTAL=|rollback)|ERROR|LINE|DETAIL|CONTEXT|psql:" || true

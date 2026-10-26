#!/bin/bash
# Rollback da 20261026140000 (roteiro Emanuella, t_fc4d9b27) e reaplicação, em banco descartável (só 127.0.0.1).
# Uso: bash scripts/leads-ia-test/test_rollback_roteiro.sh tfc4drb
set -e
DB=${1:-tfc4drb}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q -d $DB"
ROTEIRO=1 bash "$(dirname "$0")/setup.sh" "$DB" >/dev/null 2>&1
# Uma conversa no meio do roteiro novo, para ver que o rollback não quebra dados existentes.
$P -c "UPDATE public.organization_modules SET enabled = true WHERE module = 'leads'" \
   -c "SELECT public.leads_preparar_org('aaaaaaaa-0000-0000-0000-000000000000')" \
   -c "UPDATE public.lead_config SET ia_ativa = true, ia_nome = 'Emanuella' WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000000'" \
   -c "SELECT public.lead_inserir('aaaaaaaa-0000-0000-0000-000000000000', 'Maria', '15981110001', NULL, 'olx', NULL, NULL, NULL, false, NULL, 'rb1')" >/dev/null
$P -c "UPDATE public.lead_conversas SET passo = 'faixa'" >/dev/null
$P < "$W/docs/sql/rollback/20261026140000_leads_ia_roteiro_lais.rollback.sql"
$P -tAc "SELECT 'resto: ' || ((SELECT count(*) FROM information_schema.columns WHERE table_name IN ('lead_config','lead_conversas')
  AND column_name ~ '^(ia_primeira_msg|ia_reengajar|reengaje_)')
  + (SELECT count(*) FROM pg_proc WHERE proname IN ('lead_ia_tipo','lead_ia_ficha','lead_ia_imovel_frase','lead_ia_captacao',
     'lead_ia_imovel_por_codigo','lead_ia_roteiro_salvar','lead_ia_reengajar_reservar')))"
$P -tAc "SELECT 'aplicar_7_args: ' || (SELECT count(*) FROM pg_proc WHERE proname = 'lead_ia_aplicar' AND pronargs = 7)
  || ' / 8_args: ' || (SELECT count(*) FROM pg_proc WHERE proname = 'lead_ia_aplicar' AND pronargs = 8)"
$P -tAc "SELECT 'conversa_passo_depois: ' || passo FROM public.lead_conversas"
$P -tAc "SELECT 'primeira_msg_antiga: ' || (public.lead_ia_primeira_msg(l, c, 'Org A') LIKE 'Olá, Maria!%')
  FROM public.leads l, public.lead_config c WHERE l.externo_id = 'rb1' AND c.organization_id = l.organization_id" 2>/dev/null \
  || $P -tAc "SELECT 'primeira_msg_antiga: assinatura antiga ok'"
$P < "$W/supabase/migrations/20261026140000_leads_ia_roteiro_lais.sql"
$P -tAc "SELECT 'reaplicada: ' || (to_regproc('public.lead_ia_reengajar_reservar') IS NOT NULL)"

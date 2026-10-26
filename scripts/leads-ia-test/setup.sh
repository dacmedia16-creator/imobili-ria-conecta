#!/bin/bash
# Uso: bash scripts/leads-ia-test/setup.sh t8046 && docker exec -i pgt-3284-db psql -U postgres -d t8046 -q < scripts/leads-ia-test/test_ia.sql
# Banco descartável t8046 dentro do container de teste pgt-3284-db (só 127.0.0.1). Nada remoto.
set -e
DB=${1:-t8046}
W=$(cd "$(dirname "$0")/../.." && pwd)
P="docker exec -i pgt-3284-db psql -U postgres -v ON_ERROR_STOP=1 -q"
cd "$(dirname "$0")"
docker exec pgt-3284-db psql -U postgres -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
grep -v '^\\restrict\|^\\unrestrict' base.sql | $P -d $DB >/dev/null
$P -d $DB -c "TRUNCATE public.notifications"
# ROTEIRO=1 inclui o roteiro novo da Nicole (t_fc4d9b27). A base de teste não tem a coluna status da
# captação (existe em produção desde 20260925100000): o teste cria igual à produção.
MIGS="20261025120000_leads_piloto 20261025150000_leads_p2p3_distribuicao 20261025160000_leads_contato_apos_aceite 20261025170000_leads_grupo_olx 20261025180000_leads_ia_atendimento 20261025190000_leads_ia_grant_config 20261025200000_leads_ia_retorno_ziontalk"
if [ "${ROTEIRO:-0}" = "1" ]; then
  $P -d $DB -c "ALTER TABLE public.exclusive_captures ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'rascunho'"
  # Vínculo anúncio -> captação (produção: 20261009010000), só as colunas usadas por lead_portal_captacao.
  sed -n '/FUNCTION public.portal_code_key/,/^\$\$;/p' $W/supabase/migrations/20261009010000_feedback_captacao_plano.sql \
    | $P -d $DB
  $P -d $DB -c "CREATE TABLE IF NOT EXISTS public.exclusive_listing_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL, capture_id uuid NOT NULL, listing_code text NOT NULL,
    code_key text GENERATED ALWAYS AS (public.portal_code_key(listing_code)) STORED, status text NOT NULL)"
  MIGS="$MIGS 20261026170000_leads_ia_roteiro_lais"
fi
for m in $MIGS; do
  $P -d $DB < $W/supabase/migrations/$m.sql
  echo "migration $m ok"
done

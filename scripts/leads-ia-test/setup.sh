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
for m in 20261025120000_leads_piloto 20261025150000_leads_p2p3_distribuicao 20261025160000_leads_contato_apos_aceite 20261025170000_leads_grupo_olx 20261025180000_leads_ia_atendimento 20261025190000_leads_ia_grant_config 20261025200000_leads_ia_retorno_ziontalk; do
  $P -d $DB < $W/supabase/migrations/$m.sql
  echo "migration $m ok"
done

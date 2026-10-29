#!/bin/bash
# Testes do CRM (t_188fb282) num Postgres LOCAL descartável. Nada remoto; o SQL termina em ROLLBACK.
# Uso: bash scripts/crm-test/test_crm.sh <container> <banco>   (ex.: pg-c663 crm188)
# O banco precisa ser um clone estrutural do ADM com as migrations até 20261029100000 aplicadas.
set -euo pipefail
C=${1:?container}
DB=${2:?banco}
docker cp "$(dirname "$0")/test_crm.sql" "$C:/tmp/test_crm.sql" >/dev/null
docker exec "$C" psql -U supabase_admin -d "$DB" -X -q -t -A -F ' | ' -f /tmp/test_crm.sql

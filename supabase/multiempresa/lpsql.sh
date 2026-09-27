#!/usr/bin/env bash
# psql no container LOCAL descartável (nunca remoto). Uso: lpsql.sh [args psql] < arquivo.sql
set -euo pipefail
CONTAINER="${CONTAINER:-adm-mt-clone}"
exec docker exec -i -e PGPASSWORD=localtest "$CONTAINER" psql -h 127.0.0.1 -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"

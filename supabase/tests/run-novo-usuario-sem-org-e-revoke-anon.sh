#!/usr/bin/env bash
# Ensaio local da migration 20261004220000 num container Postgres DESCARTÁVEL já com o clone
# (sem rede externa). Nunca fala com banco remoto.
# Uso: CONTAINER=adm-fix-anon bash supabase/tests/run-novo-usuario-sem-org-e-revoke-anon.sh
#  antes (deve reprovar) -> up -> suíte -> rollback (fingerprint igual) -> up -> suíte
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CONTAINER="${CONTAINER:?defina CONTAINER (clone descartável)}"
PSQL=(docker exec -i "$CONTAINER" psql -X -q -U supabase_admin -d postgres)
UP="$ROOT/supabase/migrations/20261004220000_novo_usuario_sem_org_e_revoke_anon.sql"
DOWN="$ROOT/supabase/rollback/20261004220000_novo_usuario_sem_org_e_revoke_anon.sql"
SUITE="$HERE/novo_usuario_sem_org_e_revoke_anon.sql"
FP="$ROOT/supabase/multiempresa/fingerprint.sql"
# ACL como conjunto (GRANT/REVOKE pode reordenar entradas sem mudar privilégios).
ACL="SELECT md5(string_agg(x, ',' ORDER BY x)) FROM (SELECT c.relname||':'||a.grantee::regrole::text||':'||a.privilege_type x FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace='public'::regnamespace AND c.relkind='r') s;"

suite() { "${PSQL[@]}" -At < "$SUITE" 2>/dev/null | grep -E '^(TOTAL=|FALHA)' | sed "s/^/[$1] /"; }

FP0="$("${PSQL[@]}" -At < "$FP")"; ACL0="$("${PSQL[@]}" -Atc "$ACL")"
suite antes || true
"${PSQL[@]}" -v ON_ERROR_STOP=1 < "$UP"
suite "up 1"
"${PSQL[@]}" -v ON_ERROR_STOP=1 < "$DOWN"
FP2="$("${PSQL[@]}" -At < "$FP")"; ACL2="$("${PSQL[@]}" -Atc "$ACL")"
[[ "$FP0" == "$FP2" && "$ACL0" == "$ACL2" ]] && echo "rollback: schema e ACLs idênticos ao original" \
  || { echo "rollback: DIFERENTE fp=$FP0/$FP2 acl=$ACL0/$ACL2"; exit 1; }
"${PSQL[@]}" -v ON_ERROR_STOP=1 < "$UP"
suite "up 2"

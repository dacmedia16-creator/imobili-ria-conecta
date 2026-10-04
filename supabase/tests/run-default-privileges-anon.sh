#!/usr/bin/env bash
# Ensaio da migration 20261004230000 num container Postgres de clone (sem rede externa).
# Tudo roda numa ÚNICA transação revertida no fim: o clone não muda.
# Ordem: (pré-requisito 20261004220000) -> estado A -> up -> suíte -> rollback -> estado == A -> up -> suíte
# Uso: CONTAINER=adm-prod-restore bash supabase/tests/run-default-privileges-anon.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CONTAINER="${CONTAINER:?defina CONTAINER (clone)}"
strip() { grep -v -E '^(BEGIN|COMMIT|ROLLBACK);\s*$' "$1"; }
PRE="$ROOT/supabase/migrations/20261004220000_novo_usuario_sem_org_e_revoke_anon.sql"
UP="$ROOT/supabase/migrations/20261004230000_default_privileges_anon_e_limites_avatars.sql"
DOWN="$ROOT/supabase/rollback/20261004230000_default_privileges_anon_e_limites_avatars.sql"
SUITE="$HERE/default_privileges_anon.sql"
STATE="SELECT 'STATE=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT d.defaclrole::regrole::text||':'||d.defaclobjtype::text||':'||a.grantee::regrole::text||':'||a.privilege_type x
    FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE d.defaclnamespace='public'::regnamespace
  UNION ALL SELECT c.relname::text||':'||a.grantee::regrole::text||':'||a.privilege_type
    FROM pg_class c, aclexplode(c.relacl) a WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','S')
  UNION ALL SELECT id||':'||public||':'||coalesce(file_size_limit::text,'-')||':'||coalesce(allowed_mime_types::text,'-') FROM storage.buckets) s),''));"
# suíte sem BEGIN/ROLLBACK próprios -> usa SAVEPOINT
suite() { echo "SAVEPOINT s;"; strip "$SUITE"; echo "ROLLBACK TO SAVEPOINT s;"; }
{
  echo "BEGIN;"
  echo "\\echo [antes]"; suite
  # pré-requisito só se ainda não aplicado no clone
  echo "SELECT (count(*)=0) AS pre_done FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND has_table_privilege('anon',c.oid,'SELECT') \\gset"
  echo "\\if :pre_done"; echo "\\echo [pre 20261004220000 ja aplicada]"; echo "\\else"; strip "$PRE"; echo "\\echo [pre 20261004220000 aplicada na transacao]"; echo "\\endif"
  echo "$STATE"
  strip "$UP"; echo "\\echo [up 1]"; suite
  strip "$DOWN"; echo "$STATE"
  strip "$UP"; echo "\\echo [up 2]"; suite
  echo "ROLLBACK;"
} | docker exec -i "$CONTAINER" psql -X -q -At -v ON_ERROR_STOP=1 -U supabase_admin -d postgres 2>&1 \
  | grep -E '^\[|^(ok|FALHA|TOTAL=|STATE=)|ERROR' || true

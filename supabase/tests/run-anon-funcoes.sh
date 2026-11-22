#!/usr/bin/env bash
# Varredura do BANCO REAL (só leitura): lista toda função de public/academia executável sem login (anon)
# e compara com supabase/tests/anon-funcoes-permitidas.txt. Sai com código 1 se houver função aberta fora
# da lista. Também mostra tabelas/views abertas ao anon e o default privilege de funções do papel postgres.
# t_44f96aed. Uso (homologação):
#   PGCONN="$(cat /root/.config/max/adm-max-homolog-pg/conn)" PGPASSFILE=/root/.config/max/adm-max-homolog-pg/pgpass \
#     bash supabase/tests/run-anon-funcoes.sh
# ou PSQL="bash <script que roda psql> -" bash supabase/tests/run-anon-funcoes.sh
set -euo pipefail
cd "$(dirname "$0")"
LISTA=$(grep -v '^#' anon-funcoes-permitidas.txt | sed 's/#.*//' | awk 'NF{print $1}' | paste -sd'|')
if [ -n "${PSQL:-}" ]; then RUN="$PSQL"; else RUN="psql ${PGCONN:?defina PGCONN ou PSQL} -X -q -At -v ON_ERROR_STOP=1"; fi
SQL=$(cat <<SQL
BEGIN READ ONLY;
WITH perm AS (SELECT to_regprocedure(x) oid FROM unnest(string_to_array('${LISTA}', '|')) x),
ab AS (
  SELECT p.oid, p.oid::regprocedure::text sig FROM pg_proc p
   WHERE p.pronamespace IN ('public'::regnamespace, 'academia'::regnamespace)
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'))
SELECT 'FORA_DA_LISTA|' || sig FROM ab WHERE oid NOT IN (SELECT oid FROM perm WHERE oid IS NOT NULL)
UNION ALL SELECT 'PERMITIDA_ABERTA|' || sig FROM ab WHERE oid IN (SELECT oid FROM perm)
UNION ALL SELECT 'PERMITIDA_INEXISTENTE|' || x FROM unnest(string_to_array('${LISTA}', '|')) x WHERE to_regprocedure(x) IS NULL
UNION ALL SELECT 'TABELA_ANON|' || c.oid::regclass::text FROM pg_class c
   WHERE c.relnamespace IN ('public'::regnamespace, 'academia'::regnamespace) AND c.relkind IN ('r','v','m','p','f')
     AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'INSERT')
       OR has_table_privilege('anon', c.oid, 'UPDATE') OR has_table_privilege('anon', c.oid, 'DELETE'))
UNION ALL SELECT 'DEFAULT_ACL|' || coalesce(defaclnamespace::regnamespace::text, '(global)') || '|' || defaclacl::text
   FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole AND defaclobjtype = 'f'
ORDER BY 1;
ROLLBACK;
SQL
)
OUT=$(printf '%s\n' "$SQL" | $RUN)
echo "$OUT"
FORA=$(printf '%s\n' "$OUT" | grep -c '^FORA_DA_LISTA|' || true)
TAB=$(printf '%s\n' "$OUT" | grep -c '^TABELA_ANON|' || true)
echo "TOTAL fora_da_lista=$FORA tabelas_anon=$TAB"
[ "$FORA" = "0" ] && [ "$TAB" = "0" ]

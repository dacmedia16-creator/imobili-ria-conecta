#!/usr/bin/env bash
# Ensaio LOCAL completo (container descartável, sem rede). Nada toca produção.
set -u
cd "$(dirname "$0")"
DUMP=t_2898e8b5-20261105T125255Z.dump   # backup de produção de 05/11 — só o SCHEMA é restaurado (--schema-only)
C=demo-zz-pg
docker rm -f $C >/dev/null 2>&1
docker run -d --name $C -e POSTGRES_PASSWORD=localonly -v /root/.config/max/adm-max-prod-backups:/b:ro --network none \
  public.ecr.aws/supabase/postgres:17.6.1.165 >/dev/null
sleep 25
PSQL="docker exec $C psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
CHK="docker exec $C psql -U supabase_admin -d postgres -At -F="
python3 ../seed-demo-org.py --hoje 2026-11-06 --sql carga.sql --cleanup-sql limpeza.sql \
  --religar-leads-sql religar-leads.sql > dryrun.txt
sed -n '/^CREATE TRIGGER\|^CREATE CONSTRAINT/!p' 00_prep_auth.sql > /tmp/prep_a.sql
grep -E '^CREATE (CONSTRAINT )?TRIGGER' 00_prep_auth.sql > /tmp/prep_b.sql
for f in /tmp/prep_a.sql /tmp/prep_b.sql 01_fixture.sql carga.sql limpeza.sql religar-leads.sql check.sql rodizio_teste.sql \
         prazos_desligado.sql ../../../supabase/migrations/20261106200000_leads_rodizio_ignora_demo.sql; do
  docker cp "$f" $C:/tmp/ >/dev/null
done
$PSQL -f /tmp/prep_a.sql 2>&1 | grep -v NOTICE
docker exec $C pg_restore -U supabase_admin -d postgres --schema-only --no-owner --no-acl /b/$DUMP 2>&1 | grep ERROR | grep -v 'schema "public" already exists'
$PSQL -f /tmp/prep_b.sql && $PSQL -f /tmp/01_fixture.sql && echo "[ok] schema clonado + fixture"
$CHK -f /tmp/check.sql > r0_antes.txt
echo "== 1. carga SEM a trava do rodízio (tem que abortar e não gravar nada)"
$PSQL -f /tmp/carga.sql > r1.log 2>&1; echo "exit=$?"; grep -o 'ERROR.*' r1.log | head -1
$CHK -f /tmp/check.sql > r1.txt; diff -q r0_antes.txt r1.txt >/dev/null && echo "[ok] nada gravado"
echo "== 2. aplica migration da trava + carga"
$PSQL -f /tmp/20261106200000_leads_rodizio_ignora_demo.sql && echo "[ok] migration"
/usr/bin/time -f "tempo=%es" $PSQL -f /tmp/carga.sql > r2.log 2>&1; echo "exit=$?"; grep ERROR r2.log | head -3
$CHK -f /tmp/check.sql > r2.txt
echo "== 3. carga de novo (idempotência)"
$PSQL -f /tmp/carga.sql > r3.log 2>&1; echo "exit=$?"
$CHK -f /tmp/check.sql > r3.txt; diff -q r2.txt r3.txt >/dev/null && echo "[ok] 2a rodada não mudou nada"
echo "== 4. leads DESLIGADO: job de prazos não mexe em nenhum lead"
docker exec $C psql -U supabase_admin -d postgres -At -F' | ' -f /tmp/prazos_desligado.sql | grep -v -E '^(BEGIN|ROLLBACK)$'
echo "== 5. leads RELIGADO (simulado, desfeito): fictício nunca recebe lead"
docker exec $C psql -U supabase_admin -d postgres -At -F' | ' -f /tmp/rodizio_teste.sql | grep -v -E '^(BEGIN|ROLLBACK|UPDATE 1)$'
echo "== 6. limpeza"
$PSQL -f /tmp/limpeza.sql > r6.log 2>&1; echo "exit=$?"; grep ERROR r6.log | head -3
$CHK -f /tmp/check.sql > r6.txt
echo "--- diferença antes da carga x depois da limpeza:"; diff r0_antes.txt r6.txt
echo "== 7. religar leads (comando à parte)"
$PSQL -f /tmp/religar-leads.sql; $CHK -f /tmp/check.sql > r7.txt
echo "--- diferença antes da carga x depois de religar:"; diff r0_antes.txt r7.txt
echo "== fim"

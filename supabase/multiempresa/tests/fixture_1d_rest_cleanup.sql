-- Remove a fixture sintética do ensaio 1d (prefixo 3d / agência B REST) do clone local.
-- Genérico: gatilhos da aplicação podem gravar linhas derivadas (logs, histórico) em tabelas
-- com organization_id; todas as linhas da agência B sintética são removidas.
\set ON_ERROR_STOP 1
BEGIN;
-- Linhas da agência A ligadas aos usuários/vendas sintéticos (sem CASCADE em autor_id).
DELETE FROM public.juridico_agent_audit WHERE request_id LIKE 'mt1d-%' OR sale_id::text LIKE '3d05%';
DELETE FROM public.activity_logs WHERE autor_id::text LIKE '3d000000%' OR sale_id::text LIKE '3d05%';
DELETE FROM public.room_reservations WHERE responsible_id::text LIKE '3d000000%';
DELETE FROM public.sales WHERE id::text LIKE '3d05%';
DELETE FROM public.teams WHERE id::text LIKE '3d0a%';
-- Tudo o que restar da agência B, repetindo enquanto FKs entre tabelas ainda bloquearem.
DO $$
DECLARE t record; pending integer; pass integer := 0;
BEGIN
  LOOP
    pass := pass + 1; pending := 0;
    FOR t IN SELECT c.table_name FROM information_schema.columns c
              JOIN information_schema.tables x ON x.table_schema=c.table_schema AND x.table_name=c.table_name
             WHERE c.table_schema='public' AND c.column_name='organization_id' AND x.table_type='BASE TABLE'
               AND c.table_name <> 'organizations'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE organization_id = %L', t.table_name,
                       '3d000000-0000-4000-8000-0000000000b0');
      EXCEPTION WHEN foreign_key_violation THEN pending := pending + 1;
      END;
    END LOOP;
    EXIT WHEN pending = 0;
    IF pass > 6 THEN RAISE EXCEPTION 'Limpeza 1d nao convergiu'; END IF;
  END LOOP;
END $$;
DELETE FROM public.user_roles WHERE user_id::text LIKE '3d000000%';
DELETE FROM public.organization_members WHERE user_id::text LIKE '3d000000%';
DELETE FROM public.profiles WHERE id::text LIKE '3d000000%';
DELETE FROM auth.users WHERE id::text LIKE '3d000000%';
-- O gatilho de log de papéis grava 'role_revoked' ao apagar user_roles: remove esses logs também.
DELETE FROM public.activity_logs WHERE organization_id = '3d000000-0000-4000-8000-0000000000b0';
DELETE FROM public.organizations WHERE id = '3d000000-0000-4000-8000-0000000000b0';
COMMIT;

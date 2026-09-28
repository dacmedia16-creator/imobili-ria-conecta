-- Remove a fixture sintética do ensaio 1e (prefixo 3e / agência B REST 1e) do clone local.
\set ON_ERROR_STOP 1
BEGIN;
DELETE FROM public.activity_logs WHERE autor_id::text LIKE '3e000000%'
  OR payload ->> 'target_user' LIKE '3e000000%';
DELETE FROM public.team_members WHERE team_id::text LIKE '3e0a%';
DELETE FROM public.teams WHERE id::text LIKE '3e0a%' OR lider_id::text LIKE '3e000000%';
DELETE FROM public.user_roles WHERE user_id::text LIKE '3e000000%';
DELETE FROM public.organization_members WHERE user_id::text LIKE '3e000000%';
DELETE FROM public.profiles WHERE id::text LIKE '3e000000%';
DELETE FROM auth.users WHERE id::text LIKE '3e000000%';
-- O gatilho de log de papéis grava 'role_revoked' ao apagar user_roles: remove esses logs também.
DELETE FROM public.activity_logs WHERE payload ->> 'target_user' LIKE '3e000000%'
  OR organization_id = '3e000000-0000-4000-8000-0000000000b0';
DELETE FROM public.organizations WHERE id = '3e000000-0000-4000-8000-0000000000b0';
COMMIT;

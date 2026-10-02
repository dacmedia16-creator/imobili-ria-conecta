-- P2-A + P2-B do check-up de banco (t_bdb1576e). Sem mudança de regra de negócio.
-- 1) Índices faltantes em colunas de filtro/FK/policy.
-- 2) As 44 policies TO public passam a TO authenticated. Não há acesso anônimo legítimo:
--    anon não tem nenhuma policy PERMISSIVE nessas tabelas além de clientes_*/metas_*, que exigem
--    is_active_user(auth.uid()) (falso para anon). Funções SECURITY DEFINER rodam como postgres
--    (bypassrls) ou mt_1b_definer, que herda authenticated (gate abaixo), então org_isolation continua
--    valendo para elas. service_role e supabase_read_only_user têm bypassrls.
-- 3) auth.uid() e funções sem dependência da linha envolvidas em (SELECT ...) nas 7 policies.
-- Independente de 20261002000002 (contexto da plataforma); funciona antes ou depois dela.
-- Reversão: 20261002000003_mt_p2_indices_rls_authenticated.down.sql (restaura texto/papéis exatos).
BEGIN;
SET LOCAL search_path TO public;

-- Gate: só aplica sobre o estado conferido em produção/homologação em 02/10/2026.
DO $gate$ BEGIN
  IF to_regclass('public.mt_p2_backup') IS NOT NULL THEN
    RAISE EXCEPTION 'P2 ja aplicada (mt_p2_backup existe)';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND roles='{public}') <> 44 THEN
    RAISE EXCEPTION 'Esperadas 44 policies TO public';
  END IF;
  IF (SELECT md5(string_agg(tablename||policyname||coalesce(qual,'')||coalesce(with_check,''),'|'
        ORDER BY tablename, policyname)) FROM pg_policies WHERE schemaname='public'
      AND (tablename,policyname) IN (('clientes','clientes_insert'),('clientes','clientes_select'),
        ('clientes','clientes_update'),('metas','metas_select'),('metas','metas_write'),
        ('organization_members','organization_members_select'),('sale_comments','co_leader_comments_insert')))
     IS DISTINCT FROM 'b1575283bcb83fee73d8d01d54e11885' THEN
    RAISE EXCEPTION 'As 7 policies divergem do estado conferido; revisar antes de aplicar';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies p WHERE schemaname='public' AND permissive='PERMISSIVE'
      AND roles && '{public,anon}'
      AND tablename IN (SELECT tablename FROM pg_policies WHERE schemaname='public' AND roles='{public}')
      AND NOT (tablename IN ('clientes','metas'))) THEN
    RAISE EXCEPTION 'Existe policy permissiva para anon/public; acesso anonimo precisa ser revisto';
  END IF;
  -- Tirar org_isolation de PUBLIC só é seguro se todo papel com policy permissiva nessas tabelas
  -- continuar sujeito a ela (authenticated ou membro herdado de authenticated).
  IF EXISTS (SELECT 1 FROM pg_policies p, unnest(p.roles) r(rolname)
      WHERE schemaname='public' AND permissive='PERMISSIVE' AND r.rolname <> 'public'
      AND tablename IN (SELECT tablename FROM pg_policies WHERE schemaname='public' AND policyname='org_isolation')
      AND NOT pg_has_role(r.rolname::name, 'authenticated', 'USAGE')
      AND NOT (SELECT rolbypassrls FROM pg_roles WHERE pg_roles.rolname = r.rolname)) THEN
    RAISE EXCEPTION 'Papel com policy permissiva fora de authenticated; org_isolation precisa continuar valendo';
  END IF;
  IF to_regrole('mt_1b_definer') IS NOT NULL
     AND NOT pg_has_role('mt_1b_definer','authenticated','USAGE') THEN
    RAISE EXCEPTION 'mt_1b_definer nao herda authenticated; org_isolation deixaria de valer para ele';
  END IF;
END $gate$;

SET LOCAL search_path TO '';

-- Snapshot exato para o down (texto deparseado com search_path vazio = nomes qualificados).
CREATE TABLE public.mt_p2_backup (
  table_name text NOT NULL, policy_name text NOT NULL, roles text NOT NULL,
  qual text, with_check text, PRIMARY KEY (table_name, policy_name)
);
ALTER TABLE public.mt_p2_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mt_p2_backup FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.mt_p2_backup
SELECT tablename, policyname, array_to_string(roles, ','), qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname='public'
  AND (roles='{public}' OR (tablename,policyname) IN
       (('organization_members','organization_members_select'),('sale_comments','co_leader_comments_insert')));
DO $$ BEGIN IF (SELECT count(*) FROM public.mt_p2_backup) <> 46 THEN
  RAISE EXCEPTION 'Snapshot P2 incompleto'; END IF; END $$;

-- ===== P2-B: índices =====
CREATE INDEX idx_p2b_activity_logs_sale_created ON public.activity_logs (sale_id, created_at DESC);
CREATE INDEX idx_p2b_profiles_org ON public.profiles (organization_id);
CREATE INDEX idx_p2b_team_co_leaders_user ON public.team_co_leaders (user_id, organization_id);
CREATE INDEX idx_p2b_occurrence_commissions_user ON public.occurrence_commissions (user_id, organization_id);
CREATE INDEX idx_p2b_sale_parties_cliente ON public.sale_parties (cliente_id, organization_id);
CREATE INDEX idx_p2b_clientes_created_by ON public.clientes (created_by);
CREATE INDEX idx_p2b_exclusive_history_capture ON public.exclusive_history (capture_id, organization_id);
CREATE INDEX idx_p2b_metas_corretor ON public.metas (corretor_id);
CREATE INDEX idx_p2b_metas_team ON public.metas (team_id);
CREATE INDEX idx_p2b_platform_sale_cancellations_sale ON public.platform_sale_cancellations (sale_id);

-- ===== P2-A: TO authenticated (as 39 org_isolation; clientes/metas abaixo junto com o texto) =====
DO $roles$ DECLARE r record; n int := 0; BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND roles='{public}' AND policyname='org_isolation' LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated', r.policyname, r.tablename);
    n := n + 1;
  END LOOP;
  IF n <> 39 THEN RAISE EXCEPTION 'Esperadas 39 org_isolation TO public (%).', n; END IF;
END $roles$;

-- ===== P2-A: as 7 policies com (SELECT auth.uid()) — mesma lógica, avaliada uma vez por consulta =====
ALTER POLICY clientes_insert ON public.clientes TO authenticated
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid()))));
ALTER POLICY clientes_select ON public.clientes TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))));
ALTER POLICY clientes_update ON public.clientes TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid()))));

ALTER POLICY metas_select ON public.metas TO authenticated USING (
  (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'super_admin'::public.app_role]))
  OR (tipo = 'corretor' AND corretor_id = (SELECT auth.uid()))
  OR (tipo = 'corretor' AND EXISTS (SELECT 1 FROM public.team_members tm
        WHERE tm.membro_id = metas.corretor_id AND public.sees_team(tm.team_id, (SELECT auth.uid()))))
  OR (tipo = 'equipe' AND public.sees_team(team_id, (SELECT auth.uid()))));

ALTER POLICY metas_write ON public.metas TO authenticated
  USING (
    (SELECT public.is_active_user((SELECT auth.uid())))
    AND ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'super_admin'::public.app_role]))
      OR (tipo = 'corretor' AND EXISTS (SELECT 1 FROM public.team_members tm
            WHERE tm.membro_id = metas.corretor_id AND public.leads_team_or_parent(tm.team_id, (SELECT auth.uid()))))
      OR (tipo = 'equipe' AND public.leads_team_or_parent(team_id, (SELECT auth.uid())))))
  WITH CHECK (
    (SELECT public.is_active_user((SELECT auth.uid())))
    AND ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin'::public.app_role, 'super_admin'::public.app_role]))
      OR (tipo = 'corretor' AND EXISTS (SELECT 1 FROM public.team_members tm
            WHERE tm.membro_id = metas.corretor_id AND public.leads_team_or_parent(tm.team_id, (SELECT auth.uid()))))
      OR (tipo = 'equipe' AND public.leads_team_or_parent(team_id, (SELECT auth.uid())))));

ALTER POLICY organization_members_select ON public.organization_members USING (
  user_id = (SELECT auth.uid())
  OR (SELECT public.is_platform_super_admin())
  OR (organization_id = (SELECT public.current_org_id())
      AND (SELECT public.has_any_role((SELECT auth.uid()),
            ARRAY['admin'::public.app_role, 'super_admin'::public.app_role, 'gestor'::public.app_role, 'team_leader'::public.app_role]))));

ALTER POLICY co_leader_comments_insert ON public.sale_comments WITH CHECK (
  autor_id = (SELECT auth.uid()) AND public.can_manage_sale_as_co_leader(sale_id));

-- Leitura de volta dentro da transação.
DO $check$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND roles='{public}') THEN
    RAISE EXCEPTION 'Ainda ha policy TO public'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public'
      AND (tablename,policyname) IN (SELECT table_name, policy_name FROM public.mt_p2_backup)
      AND regexp_replace(coalesce(qual,'')||' '||coalesce(with_check,''),
            '\(\s*SELECT auth\.uid\(\) AS uid\)', '', 'g') ~ 'auth\.uid\(\)') THEN
    RAISE EXCEPTION 'auth.uid() sem (SELECT) remanescente'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx\_p2b\_%') <> 10 THEN
    RAISE EXCEPTION 'Indices P2-B incompletos'; END IF;
END $check$;
COMMIT;

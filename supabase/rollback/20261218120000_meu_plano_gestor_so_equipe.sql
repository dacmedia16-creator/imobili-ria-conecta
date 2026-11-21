-- Rollback de 20261218120000_meu_plano_gestor_so_equipe (cartões t_889fb3c1/t_48670ed3).
-- Devolve o gestor à visão da imobiliária toda: política carreira_plano_ler e carreira_plano_equipe voltam ao
-- corpo da 20261119120000 (broker = gestor/admin/super_admin). Nenhum dado é apagado.

DROP POLICY IF EXISTS carreira_plano_ler ON public.carreira_plano;
CREATE POLICY carreira_plano_ler ON public.carreira_plano FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.meu_plano_eh_broker((SELECT auth.uid()))));

CREATE OR REPLACE FUNCTION public.carreira_plano_equipe(_ano integer)
RETURNS TABLE(user_id uuid, nome text, avatar_url text, trilha text, ativacao_inicio date, respostas jsonb,
              assinado_corretor_em timestamptz, assinado_broker_em timestamptz, meta_oficial_em timestamptz,
              updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _broker boolean;
BEGIN
  _org := public.meu_plano_org_ok();
  _broker := public.meu_plano_eh_broker(_me);
  IF NOT _broker AND NOT EXISTS (SELECT 1 FROM public.teams t
                                  WHERE t.organization_id = _org AND public.leads_team_or_parent(t.id, _me)) THEN
    RAISE EXCEPTION 'Só gestor, administrador ou líder de equipe vê a equipe' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.nome, pr.avatar_url, cp.trilha, cp.ativacao_inicio, coalesce(cp.respostas, '{}'::jsonb),
         cp.assinado_corretor_em, cp.assinado_broker_em, cp.meta_oficial_em, cp.updated_at
    FROM public.organization_members m
    JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
    LEFT JOIN public.carreira_plano cp ON cp.organization_id = _org AND cp.user_id = pr.id AND cp.ano = _ano
   WHERE m.organization_id = _org AND m.ativo
     AND CASE WHEN _broker THEN
           (cp.id IS NOT NULL OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pr.id
              AND ur.organization_id = _org AND ur.role IN ('corretor', 'team_leader', 'gestor')))
         ELSE pr.id <> _me AND EXISTS (
              SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
               WHERE tm.membro_id = pr.id AND t.organization_id = _org
                 AND public.leads_team_or_parent(t.id, _me)) END
   ORDER BY cp.updated_at DESC NULLS LAST, pr.nome;
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_equipe(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_equipe(integer) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.meu_plano_ve_imobiliaria(uuid);

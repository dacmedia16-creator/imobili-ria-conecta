-- Rollback de 20261119120000_meu_plano_2027_pdf_lider (cartão t_65edd0b0).
-- Tira a leitura do plano pelo team leader e devolve carreira_plano_equipe ao corpo da 20261107120000
-- (só broker). Nenhum dado é apagado.

DROP POLICY IF EXISTS carreira_plano_ler_lider ON public.carreira_plano;
DROP FUNCTION IF EXISTS public.meu_plano_lider_ve(uuid);

CREATE OR REPLACE FUNCTION public.carreira_plano_equipe(_ano integer)
RETURNS TABLE(user_id uuid, nome text, avatar_url text, trilha text, ativacao_inicio date, respostas jsonb,
              assinado_corretor_em timestamptz, assinado_broker_em timestamptz, meta_oficial_em timestamptz,
              updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid;
BEGIN
  _org := public.meu_plano_org_ok();
  IF NOT public.meu_plano_eh_broker(_me) THEN
    RAISE EXCEPTION 'Só gestor ou administrador vê a equipe' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.nome, pr.avatar_url, cp.trilha, cp.ativacao_inicio, coalesce(cp.respostas, '{}'::jsonb),
         cp.assinado_corretor_em, cp.assinado_broker_em, cp.meta_oficial_em, cp.updated_at
    FROM public.organization_members m
    JOIN public.profiles pr ON pr.id = m.user_id AND pr.ativo
    LEFT JOIN public.carreira_plano cp ON cp.organization_id = _org AND cp.user_id = pr.id AND cp.ano = _ano
   WHERE m.organization_id = _org AND m.ativo
     AND (cp.id IS NOT NULL OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = pr.id
            AND ur.organization_id = _org AND ur.role IN ('corretor', 'team_leader', 'gestor')))
   ORDER BY cp.updated_at DESC NULLS LAST, pr.nome;
END $$;
REVOKE ALL ON FUNCTION public.carreira_plano_equipe(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_equipe(integer) TO authenticated, service_role;

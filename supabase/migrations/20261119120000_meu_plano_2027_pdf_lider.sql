-- Meu Plano 2027 → "Baixar meu plano em PDF" (cartão t_65edd0b0; aprovado por Denis em 12/11/2026, tópico 6238).
--
-- ADITIVA. Rollback: docs/sql/rollback/20261119120000_meu_plano_2027_pdf_lider.rollback.sql
-- Teste: supabase/tests/run-meu-plano-2027-pdf.sh (transação desfeita; homologação ou banco local).
--
-- Regra aprovada de quem baixa o PDF (o PDF é montado no navegador com o que a pessoa consegue LER):
--   - corretor: o próprio plano (política carreira_plano_ler, já existente);
--   - gestor, admin e administrador principal: qualquer plano da própria imobiliária (carreira_plano_ler);
--   - team leader: só o plano dos membros das equipes que ele lidera (NOVO, abaixo). Mesma regra do diário da
--     equipe (carreira_diario_equipe_semana): team_members + leads_team_or_parent (líder, colíder ou líder da
--     equipe-mãe), na imobiliária atual.
-- Nenhum acesso entre imobiliárias: a política RESTRICTIVE org_isolation (organization_id = current_org_id())
-- e a modulo_ligado continuam valendo para todas as leituras. O líder só LÊ; nada aqui grava.

-- 1) O líder vê o plano deste colaborador? ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_plano_lider_ve(_alvo uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND _alvo IS NOT NULL AND _alvo <> auth.uid()
     AND public.is_active_user(auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.team_members tm JOIN public.teams t ON t.id = tm.team_id
        WHERE tm.membro_id = _alvo AND t.organization_id = public.current_org_id()
          AND public.leads_team_or_parent(t.id, auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.meu_plano_lider_ve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_plano_lider_ve(uuid) TO authenticated, service_role;

-- 2) Leitura (RLS): o líder lê o plano dos membros da equipe. Somente SELECT (authenticated não tem
--    INSERT/UPDATE/DELETE na tabela). As RESTRICTIVE org_isolation e modulo_ligado seguem valendo.
DROP POLICY IF EXISTS carreira_plano_ler_lider ON public.carreira_plano;
CREATE POLICY carreira_plano_ler_lider ON public.carreira_plano FOR SELECT TO authenticated
  USING (public.meu_plano_lider_ve(user_id));

-- 3) Lista da equipe: o broker vê a imobiliária (igual a antes); o líder vê só os membros das equipes que
--    lidera; os outros continuam recusados (42501). Mesmas colunas de antes.
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

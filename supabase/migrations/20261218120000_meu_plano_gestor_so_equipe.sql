-- Planos 2027 · Preenchimento: o GESTOR vê só a própria equipe (cartões t_889fb3c1/t_48670ed3; decisão de Denis
-- em 21/11/2026, tópico 6238, "opção 1"). Mesma regra do Painel da Equipe (painel_equipe_permitido, migration
-- 20261008180000): admin/super_admin = todas as equipes; gestor/team_leader = só leads_team_or_parent.
--
-- Rollback: supabase/rollback/20261218120000_meu_plano_gestor_so_equipe.sql
-- Teste: supabase/tests/run-meu-plano-gestor-so-equipe.sh (transação desfeita; homologação ou banco local).
--
-- O que muda (só LEITURA dos planos):
--   * carreira_plano_equipe: admin/super_admin veem a imobiliária toda (igual a antes); gestor e TL veem só os
--     membros das equipes que lideram/co-lideram (ou equipe-mãe). Gestor sem equipe recebe lista VAZIA (não erro).
--   * política carreira_plano_ler: o acesso amplo passa a ser só admin/super_admin. O gestor lê pela
--     carreira_plano_ler_lider (meu_plano_lider_ve, migration 20261119120000), que já usa leads_team_or_parent.
-- O que NÃO muda (de propósito): meu_plano_eh_broker (assinatura do pacto como broker, reabrir, Inteligência de
-- gestão, diário da equipe). As RESTRICTIVE org_isolation e modulo_ligado continuam valendo.

-- 1) Quem vê os planos da imobiliária TODA (somente leitura). ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_plano_ve_imobiliaria(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _uid IS NOT NULL AND coalesce(public.has_any_role(_uid, ARRAY['admin', 'super_admin']::public.app_role[]), false)
$$;
REVOKE ALL ON FUNCTION public.meu_plano_ve_imobiliaria(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_plano_ve_imobiliaria(uuid) TO authenticated, service_role;

-- 2) Leitura (RLS): corretor lê o próprio; admin/super_admin leem a imobiliária. Gestor/TL: carreira_plano_ler_lider.
DROP POLICY IF EXISTS carreira_plano_ler ON public.carreira_plano;
CREATE POLICY carreira_plano_ler ON public.carreira_plano FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.meu_plano_ve_imobiliaria((SELECT auth.uid()))));

-- 3) Lista da equipe. Mesmas colunas e mesma ordem de antes. ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.carreira_plano_equipe(_ano integer)
RETURNS TABLE(user_id uuid, nome text, avatar_url text, trilha text, ativacao_inicio date, respostas jsonb,
              assinado_corretor_em timestamptz, assinado_broker_em timestamptz, meta_oficial_em timestamptz,
              updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid(); _org uuid; _amplo boolean;
BEGIN
  _org := public.meu_plano_org_ok();
  _amplo := public.meu_plano_ve_imobiliaria(_me);
  -- Gestor entra mesmo sem equipe (lista vazia, igual ao Painel da Equipe); TL sem equipe e corretor: recusa.
  IF NOT _amplo AND NOT public.meu_plano_eh_broker(_me)
     AND NOT EXISTS (SELECT 1 FROM public.teams t
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
     AND CASE WHEN _amplo THEN
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

-- t_205ec8f5 (Denis 25/11, "A e B"): pacote financeiro do gestor sem statement timeout.
-- Antes, o pacote (fetchFinanceiroBundle) lia occurrence_commissions e occurrence_partners direto,
-- e o RLS de SELECT dessas tabelas recalculava as vendas visíveis (vendas_visiveis_ids → liderados,
-- equipes, co-líderes) em VÁRIAS políticas na mesma leitura, e de novo em cada página. Para gestor,
-- 4–6 s por leitura em produção; em pico, 8 s = 57014 (5 erros em 24/11).
--
-- Esta RPC devolve as MESMAS linhas que o RLS de SELECT deixa o usuário ver, calculando o conjunto de
-- ocorrências visíveis UMA vez. Não cria regra nova: usa as mesmas funções das políticas.
-- Políticas de SELECT de occurrence_commissions / occurrence_partners (iguais nas duas tabelas):
--   RESTRICTIVE: org_isolation (organization_id = current_org_id()), zz_fotografo_fora, zz_locacao_fora
--   PERMISSIVE (basta uma):
--     zz_mt_leitor_amplo_select  has_any_role(uid, financeiro/admin/super_admin)        → _amplo
--     occ_*_view                 occurrence_id IN ocorrencias_visiveis_ids()             → bloco 1
--     *_co_leader_principal_read occurrence_id IN ocorrencias_coleader_leitura_ids()     → bloco 2
--     co_leader_*_write (ALL)    ocorrência (visível pelo RLS de occurrences, isto é, da org atual)
--                                com sale_id IN vendas_coleader_edicao_ids()             → bloco 3
--     occ_*_write (ALL)          ocorrência da org atual com sale_id IN vendas_visiveis_ids() + papel
--                                → contido no bloco 1 (mesma org, mesma vendas_visiveis_ids)
-- Só leitura. Não muda política, tabela nem statement_timeout.
-- Rollback: docs/sql/rollback/20270106120000_financeiro_comissoes_parcerias_visiveis.rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.financeiro_comissoes_parcerias_visiveis()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _amplo boolean;
  _occ uuid[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  _org := public.current_org_id();
  -- Mesmas travas RESTRICTIVE das tabelas: sem org atual, só-fotógrafo ou só-Locação = nada.
  IF _org IS NULL OR public.eh_so_fotografo(_uid) OR public.eh_so_locacao(_uid) THEN
    RETURN jsonb_build_object('comissoes', '[]'::jsonb, 'parcerias', '[]'::jsonb);
  END IF;

  _amplo := coalesce(public.has_any_role(_uid,
    ARRAY['financeiro', 'admin', 'super_admin']::public.app_role[]), false);

  IF NOT _amplo THEN
    SELECT coalesce(array_agg(DISTINCT s.id), '{}'::uuid[]) INTO _occ
    FROM (
      SELECT public.ocorrencias_visiveis_ids() AS id                       -- bloco 1
      UNION
      SELECT public.ocorrencias_coleader_leitura_ids()                      -- bloco 2
      UNION
      SELECT o.id FROM public.occurrences o                                 -- bloco 3
       WHERE o.organization_id = _org
         AND o.sale_id IN (SELECT public.vendas_coleader_edicao_ids())
    ) s
    WHERE s.id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'comissoes', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id,
               'occurrence_id', c.occurrence_id,
               'papel', c.papel,
               'nome', c.nome,
               'percentual', c.percentual,
               'valor', c.valor,
               'user_id', c.user_id,
               'managed_by_sale', c.managed_by_sale,
               'sale_commission_extra_id', c.sale_commission_extra_id,
               'sem_cadastro_confirmado', c.sem_cadastro_confirmado) ORDER BY c.id)
        FROM public.occurrence_commissions c
       WHERE c.organization_id = _org
         AND (_amplo OR c.occurrence_id = ANY (_occ))), '[]'::jsonb),
    'parcerias', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id,
               'occurrence_id', p.occurrence_id,
               'valor', p.valor) ORDER BY p.id)
        FROM public.occurrence_partners p
       WHERE p.organization_id = _org
         AND (_amplo OR p.occurrence_id = ANY (_occ))), '[]'::jsonb)
  );
END
$$;

COMMENT ON FUNCTION public.financeiro_comissoes_parcerias_visiveis() IS
  'Pacote financeiro (t_205ec8f5): comissões e parcerias das ocorrências que o usuário vê pelo RLS de SELECT, com o conjunto de ocorrências visíveis calculado uma vez.';

REVOKE ALL ON FUNCTION public.financeiro_comissoes_parcerias_visiveis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_comissoes_parcerias_visiveis() TO authenticated;

COMMIT;

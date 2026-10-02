-- Acelera o resumo da tela Início (painel do gestor / Central Financeira) para quem já lê TODAS as
-- vendas da imobiliária: financeiro, admin, super_admin (e o super admin em contexto de plataforma).
--
-- Causa medida (EXPLAIN, cópia local de produção): nas tabelas filhas de venda, as policies de SELECT
-- chamam can_view_sale(uid, sale_id) / can_read_principal_sale_as_co_leader / can_manage_... /
-- can_read_sale_juridico_certidao POR LINHA (plpgsql SECURITY DEFINER encadeado). Para esses papéis o
-- resultado é sempre "vê", mas o custo é pago linha a linha: sale_status_history (1.343 linhas) = 410 ms
-- só de RLS; vendas_comerciais_canonicas, financeiro_distribuicao_vendas e dashboard_stats somam
-- segundos e, em produção, batem no statement_timeout de 8 s.
--
-- Mudança: UMA policy permissiva de SELECT por tabela, TO authenticated, cujo predicado não depende da
-- linha — `(SELECT has_any_role((SELECT auth.uid()), {financeiro,admin,super_admin}))` — e por isso
-- vira InitPlan (avaliado uma vez por consulta). É exatamente o ramo de can_view_sale que já libera
-- esses papéis (has_any_role é o mesmo helper, inclusive no contexto de plataforma, mt.ctx_pc).
-- Policies permissivas se somam por OR: nenhuma policy existente é alterada ou removida.
--
-- Isolamento por imobiliária: a policy RESTRICTIVE org_isolation (organization_id = current_org_id())
-- continua valendo em cima desta. As FKs compostas (sale_id/occurrence_id, organization_id) garantem que
-- a venda/ocorrência-mãe é da mesma imobiliária, então o resultado é idêntico ao de can_view_sale para
-- esses papéis. anon não é afetado (TO authenticated); usuário inativo falha em has_any_role.
--
-- Escopo: só as 6 tabelas lidas pelo resumo (RPCs + bundle financeiro). Escrita (INSERT/UPDATE/DELETE)
-- não muda. Rollback: .down.sql (DROP das 6 policies).
BEGIN;

DO $m$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sale_status_history', 'occurrences', 'occurrence_commissions',
    'occurrence_partners', 'sale_commission_extras', 'sale_parties']
  LOOP
    -- gate: a tabela precisa ter o isolamento restritivo por imobiliária antes de ganhar a policy ampla
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'org_isolation' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL'
        AND roles = '{authenticated}') THEN
      RAISE EXCEPTION 'leitor_amplo: %.org_isolation RESTRICTIVE TO authenticated ausente', t;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS zz_mt_leitor_amplo_select ON public.%I', t);
    EXECUTE format($p$CREATE POLICY zz_mt_leitor_amplo_select ON public.%I AS PERMISSIVE FOR SELECT
      TO authenticated USING ((SELECT public.has_any_role((SELECT auth.uid()),
        ARRAY['financeiro', 'admin', 'super_admin']::public.app_role[])))$p$, t);
  END LOOP;
END $m$;

COMMIT;

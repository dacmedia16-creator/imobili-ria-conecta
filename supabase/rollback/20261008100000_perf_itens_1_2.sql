-- DESFAZER itens 1 e 2 (20261008100000/100100/100200). Gerado por supabase/tests/perf_itens_1_2/gerar_sql.py
-- a partir das definições de PRODUÇÃO lidas em modo somente leitura. Restaura policies (USING) e funções
-- originais e remove o que foi criado. NENHUM dado de venda é alterado: a tabela venda_distribuicao só
-- guarda resultado de cálculo (pode ser apagada e recriada a qualquer momento).
-- Depois de rodar, remover 20261008100000/100100/100200 de supabase_migrations.schema_migrations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = public, extensions;
-- 1) policies: USING original de produção
ALTER POLICY "co_leader_activity_read" ON public."activity_logs" USING (can_manage_sale_as_co_leader(sale_id));
ALTER POLICY "juridico_returned_activity_read" ON public."activity_logs" USING (can_read_sale_juridico_certidao(sale_id));
ALTER POLICY "log_view" ON public."activity_logs" USING ((((sale_id IS NULL) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::app_role, 'super_admin'::app_role]) AS has_any_role)) OR ((sale_id IS NOT NULL) AND can_view_sale(( SELECT auth.uid() AS uid), sale_id))));
ALTER POLICY "view extractions if can view sale" ON public."document_extractions" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "co_leader_commissions_write" ON public."occurrence_commissions" USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_edit_sale_as_co_leader(o.sale_id)))));
ALTER POLICY "occ_comm_view" ON public."occurrence_commissions" USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id)))));
ALTER POLICY "occ_comm_write" ON public."occurrence_commissions" USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role)))));
ALTER POLICY "occurrence_commissions_co_leader_principal_read" ON public."occurrence_commissions" USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_commissions.occurrence_id) AND can_read_principal_sale_as_co_leader(o.sale_id)))));
ALTER POLICY "co_leader_partners_write" ON public."occurrence_partners" USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_edit_sale_as_co_leader(o.sale_id)))));
ALTER POLICY "occ_part_view" ON public."occurrence_partners" USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id)))));
ALTER POLICY "occ_part_write" ON public."occurrence_partners" USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_view_sale(( SELECT auth.uid() AS uid), o.sale_id) AND ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role)))));
ALTER POLICY "occurrence_partners_co_leader_principal_read" ON public."occurrence_partners" USING ((EXISTS ( SELECT 1
   FROM occurrences o
  WHERE ((o.id = occurrence_partners.occurrence_id) AND can_read_principal_sale_as_co_leader(o.sale_id)))));
ALTER POLICY "co_leader_occurrence_write" ON public."occurrences" USING (can_edit_sale_as_co_leader(sale_id));
ALTER POLICY "occ_view" ON public."occurrences" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "occ_write" ON public."occurrences" USING ((( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role, 'gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND can_view_sale(( SELECT auth.uid() AS uid), sale_id)));
ALTER POLICY "occurrences_co_leader_principal_read" ON public."occurrences" USING (can_read_principal_sale_as_co_leader(sale_id));
ALTER POLICY "co_leader_bank_read" ON public."sale_bank_accounts" USING (can_manage_sale_as_co_leader(sale_id));
ALTER POLICY "co_leader_bank_write" ON public."sale_bank_accounts" USING (can_edit_sale_as_co_leader(sale_id));
ALTER POLICY "juridico_returned_bank_read" ON public."sale_bank_accounts" USING (can_read_sale_juridico_certidao(sale_id));
ALTER POLICY "sale_bank_select" ON public."sale_bank_accounts" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "sale_comment_recipients_view" ON public."sale_comment_recipients" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "co_leader_comments_read" ON public."sale_comments" USING (can_manage_sale_as_co_leader(sale_id));
ALTER POLICY "juridico_returned_comments_read" ON public."sale_comments" USING (can_read_sale_juridico_certidao(sale_id));
ALTER POLICY "sale_comments_view" ON public."sale_comments" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "co_leader_extras_write" ON public."sale_commission_extras" USING (can_edit_sale_as_co_leader(sale_id));
ALTER POLICY "juridico_returned_extras_read" ON public."sale_commission_extras" USING (can_read_sale_juridico_certidao(sale_id));
ALTER POLICY "sale_commission_extras_co_leader_principal_read" ON public."sale_commission_extras" USING (can_read_principal_sale_as_co_leader(sale_id));
ALTER POLICY "sale_commission_extras_select" ON public."sale_commission_extras" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "co_leader_documents_read" ON public."sale_documents" USING (((deleted_at IS NULL) AND can_manage_sale_as_co_leader(sale_id)));
ALTER POLICY "juridico_returned_documents_read" ON public."sale_documents" USING (can_read_sale_juridico_certidao(sale_id));
ALTER POLICY "sale_docs_select" ON public."sale_documents" USING ((can_view_sale(( SELECT auth.uid() AS uid), sale_id) AND ((deleted_at IS NULL) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['admin'::app_role, 'super_admin'::app_role]) AS has_any_role))));
ALTER POLICY "sale_geo_read" ON public."sale_geo" USING (((organization_id = ( SELECT current_org_id() AS current_org_id)) AND ( SELECT mt_1b_gate() AS mt_1b_gate) AND can_view_sale(( SELECT auth.uid() AS uid), sale_id)));
ALTER POLICY "co_leader_parties_write" ON public."sale_parties" USING (can_edit_sale_as_co_leader(sale_id));
ALTER POLICY "juridico_returned_parties_read" ON public."sale_parties" USING (can_read_sale_juridico_certidao(sale_id));
ALTER POLICY "sale_parties_co_leader_principal_read" ON public."sale_parties" USING (can_read_principal_sale_as_co_leader(sale_id));
ALTER POLICY "sale_parties_select" ON public."sale_parties" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "co_leader_payment_write" ON public."sale_payment" USING (can_edit_sale_as_co_leader(sale_id));
ALTER POLICY "juridico_returned_payment_read" ON public."sale_payment" USING (can_read_sale_juridico_certidao(sale_id));
ALTER POLICY "sale_payment_co_leader_principal_read" ON public."sale_payment" USING (can_read_principal_sale_as_co_leader(sale_id));
ALTER POLICY "sale_payment_select" ON public."sale_payment" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "co_leader_history_read" ON public."sale_status_history" USING (can_manage_sale_as_co_leader(sale_id));
ALTER POLICY "history_view" ON public."sale_status_history" USING (can_view_sale(( SELECT auth.uid() AS uid), sale_id));
ALTER POLICY "juridico_returned_history_read" ON public."sale_status_history" USING (can_read_sale_juridico_certidao(sale_id));
ALTER POLICY "juridico_returned_sale_read" ON public."sales" USING (can_read_sale_juridico_certidao(id));
ALTER POLICY "sales_co_leader_principal_read" ON public."sales" USING (can_read_principal_sale_as_co_leader(id));
ALTER POLICY "sales_select" ON public."sales" USING ((( SELECT is_active_user(( SELECT auth.uid() AS uid)) AS is_active_user) AND ((corretor_id = ( SELECT auth.uid() AS uid)) OR (corretor_captador_id = ( SELECT auth.uid() AS uid)) OR (corretor_vendedor_id = ( SELECT auth.uid() AS uid)) OR (lider_captador_id = ( SELECT auth.uid() AS uid)) OR (lider_vendedor_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM sale_commission_extras sce
  WHERE ((sce.sale_id = sales.id) AND (sce.user_id = ( SELECT auth.uid() AS uid))))) OR ( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role]) AS has_any_role) OR (( SELECT has_any_role(( SELECT auth.uid() AS uid), ARRAY['gestor'::app_role, 'team_leader'::app_role]) AS has_any_role) AND (is_lead_of(( SELECT auth.uid() AS uid), corretor_id) OR is_lead_of_sale_corretor(( SELECT auth.uid() AS uid), id))) OR (( SELECT has_role(( SELECT auth.uid() AS uid), 'juridico'::app_role) AS has_role) AND ((status)::text = ANY (ARRAY['aprovada_gestor'::text, 'enviada_juridico'::text, 'em_elaboracao_contrato'::text, 'contrato_conferencia_gestor'::text, 'contrato_conferencia_corretor'::text, 'contrato_ok_corretor'::text, 'aguardando_assinatura'::text, 'contrato_assinado'::text, 'ocorrencia_pendente'::text, 'ocorrencia_analise_financeiro'::text, 'ocorrencia_devolvida_gestor'::text, 'ocorrencia_concluida'::text]))))));
-- 2) relatórios voltam a calcular ao vivo (texto original de produção)
CREATE OR REPLACE FUNCTION public.dashboard_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with parceria_por_occ as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0)
      from occurrence_commissions
      where sem_cadastro_confirmado
    ) p
    group by occurrence_id
  ),
  distribuicao_por_occ as (
    select
      o.id as occurrence_id,
      public.calcular_distribuicao_venda(s.*) as resultado
    from occurrences o
    join sales s on s.id = o.sale_id
  ),
  minha_parte_ocorrencia as (
    -- Venda com ocorrência: a parte do usuário é a linha dele em occurrence_commissions.
    select sum(oc.valor) as valor
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join sales s on s.id = o.sale_id
    where oc.user_id = auth.uid()
      and coalesce(oc.sem_cadastro_confirmado, false) = false
      and s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
  ),
  minha_parte_venda as (
    -- Antes da ocorrência: líquido do lado em que participa (mesma distribuição oficial),
    -- indicador, líder e extras vinculados à conta do usuário.
    select sum(
      case when s.corretor_captador_id = auth.uid() then coalesce((d.r->>'liquido_captador')::numeric, 0) else 0 end
      + case when s.corretor_vendedor_id = auth.uid() then coalesce((d.r->>'liquido_vendedor')::numeric, 0) else 0 end
      + case when s.indicador_captador_id = auth.uid() then coalesce(s.valor_comissao_indicador_captador, 0) else 0 end
      + case when s.indicador_vendedor_id = auth.uid() then coalesce(s.valor_comissao_indicador_vendedor, 0) else 0 end
      + case when s.lider_captador_id = auth.uid() then coalesce(s.valor_comissao_lider_captador, 0) else 0 end
      + case when s.lider_vendedor_id = auth.uid() then coalesce(s.valor_comissao_lider_vendedor, 0) else 0 end
      + coalesce((select sum(coalesce(e.valor, 0)) from sale_commission_extras e
                  where e.sale_id = s.id and e.user_id = auth.uid()
                    and coalesce(e.sem_cadastro_confirmado, false) = false), 0)
    ) as valor
    from sales s
    cross join lateral (select public.calcular_distribuicao_venda(s.*) as r) d
    where s.status::text not in ('ocorrencia_concluida','arquivada','cancelada')
      and not exists (select 1 from occurrences o where o.sale_id = s.id)
      and (
        auth.uid() in (s.corretor_captador_id, s.corretor_vendedor_id, s.indicador_captador_id,
                       s.indicador_vendedor_id, s.lider_captador_id, s.lider_vendedor_id)
        or exists (select 1 from sale_commission_extras e where e.sale_id = s.id and e.user_id = auth.uid())
      )
  )
  select jsonb_build_object(
    'funil', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from sales group by status
      ) t
    ),
    'minhas_vendas', (select count(*) from sales s where public.is_sale_corretor(auth.uid(), s.id)),
    'minhas_pendencias', (select count(*) from sales s where s.status::text in ('rascunho','devolvida_ajuste') and public.is_sale_responsavel(auth.uid(), s.id)),
    'meus_contratos_conferir', (select count(*) from sales s where s.status::text = 'contrato_conferencia_corretor' and public.is_sale_responsavel(auth.uid(), s.id)),
    'meus_assinados', (select count(*) from sales s where s.status::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida') and public.is_sale_corretor(auth.uid(), s.id)),
    'minha_comissao_prevista', coalesce((select valor from minha_parte_ocorrencia), 0) + coalesce((select valor from minha_parte_venda), 0),
    'gestor_aguardando_revisao', (select count(*) from sales where status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (select count(*) from sales where status::text in ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (select count(*) from sales where status::text in ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (select count(*) from sales where status::text in ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (select count(*) from sales where status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (select count(*) from sales where status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (select count(*) from sales where status::text = 'aguardando_assinatura'),
    'juridico_assinados', (select count(*) from sales where status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (select count(*) from sales where status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (select count(*) from sales where status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (select count(*) from occurrences o join sales s on s.id = o.sale_id where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'occ_concluidas_total', (select count(*) from occurrences o join sales s on s.id = o.sale_id where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')),
    'comissao_prevista_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_concluida_total', coalesce((
      select sum(o.valor_comissao - coalesce(p.valor, 0))
      from occurrences o
      join sales s on s.id = o.sale_id
      left join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_prevista_total', coalesce((
      select sum(p.valor)
      from occurrences o
      join sales s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_parceria_externa_concluida_total', coalesce((
      select sum(p.valor)
      from occurrences o
      join sales s on s.id = o.sale_id
      join parceria_por_occ p on p.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_prevista_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from occurrences o
      join sales s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status <> 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'liquido_imobiliaria_concluida_total', coalesce((
      select sum(coalesce(
        (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
        (d.resultado->>'saldo_imobiliaria')::numeric,
        0
      ))
      from occurrences o
      join sales s on s.id = o.sale_id
      join distribuicao_por_occ d on d.occurrence_id = o.id
      where o.status = 'concluida' and s.status::text not in ('cancelada','arquivada')
    ), 0),
    'comissao_por_corretor', (
      select coalesce(jsonb_object_agg(user_id, total), '{}'::jsonb) from (
        select oc.user_id::text as user_id, sum(oc.valor) as total
        from occurrence_commissions oc
        join occurrences o on o.id = oc.occurrence_id
        join sales s on s.id = o.sale_id
        where s.status::text not in ('cancelada','arquivada') and oc.user_id is not null
        group by oc.user_id
      ) t
    )
  );
$function$;
CREATE OR REPLACE FUNCTION public.financeiro_distribuicao_vendas()
 RETURNS TABLE(sale_id uuid, saldo_inicial_imobiliaria numeric, saldo_liquido_imobiliaria numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    v.sale_id,
    coalesce((d.resultado->>'saldo_inicial_imobiliaria')::numeric, 0),
    coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )
  from public.vendas_comerciais_canonicas() v
  join public.sales s on s.id = v.sale_id
  cross join lateral (
    select public.calcular_distribuicao_venda(s.*) as resultado
  ) d
  where s.status::text not in ('cancelada', 'arquivada')
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$function$;
-- 3) gatilhos, funções e tabela do resultado gravado
DROP TRIGGER IF EXISTS zz_venda_distribuicao ON public.sales;
DROP TRIGGER IF EXISTS zz_venda_distribuicao ON public.sale_commission_extras;
DROP TRIGGER IF EXISTS zz_venda_distribuicao ON public.occurrences;
DROP TRIGGER IF EXISTS zz_venda_distribuicao ON public.occurrence_commissions;
DROP FUNCTION IF EXISTS public.trg_venda_distribuicao();
DROP FUNCTION IF EXISTS public.venda_distribuicao_recalcular_todas();
DROP FUNCTION IF EXISTS public.venda_distribuicao_conferir();
DROP FUNCTION IF EXISTS public.venda_distribuicao_recalcular(uuid);
DROP TABLE IF EXISTS public.venda_distribuicao;
-- 4) funções de lista (nenhuma policy as usa mais)
DROP FUNCTION IF EXISTS public.vendas_visiveis_ids();
DROP FUNCTION IF EXISTS public.vendas_coleader_leitura_ids();
DROP FUNCTION IF EXISTS public.vendas_coleader_gestao_ids();
DROP FUNCTION IF EXISTS public.vendas_coleader_edicao_ids();
DROP FUNCTION IF EXISTS public.vendas_juridico_certidao_ids();
-- 5) conferência: nenhuma policy pode continuar citando as listas
DO $c$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'')||coalesce(with_check,'')) ~ 'vendas_(visiveis|coleader_[a-z]+|juridico_certidao)_ids') THEN
    RAISE EXCEPTION 'desfazer incompleto: policy ainda usa lista nova';
  END IF;
END $c$;
-- A cópia de segurança em max_backup.definicoes (etapa 0) é mantida de propósito.
COMMIT;

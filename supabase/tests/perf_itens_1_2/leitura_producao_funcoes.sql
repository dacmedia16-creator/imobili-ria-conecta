select p.oid::regprocedure::text sig, p.proname, p.prosecdef, p.provolatile, coalesce(p.proacl::text,'') acl, pg_get_functiondef(p.oid) def
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in
('dashboard_stats','financeiro_distribuicao_vendas','vendas_comerciais_canonicas','comparativo_comissao_6pct','comparativo_comissao_6pct_inconsistencias',
 'can_view_sale','is_lead_of','is_lead_of_sale_corretor','sale_corretores','user_org','mt_in_ctx_org','current_org_id','mt_1b_gate','is_active_user','has_any_role','has_role',
 'can_read_principal_sale_as_co_leader','can_manage_sale_as_co_leader','can_read_sale_juridico_certidao','can_edit_sale_as_co_leader','calcular_distribuicao_venda','mt_ctx_org',
 'vendas_visiveis_ids','vendas_coleader_leitura_ids','vendas_coleader_gestao_ids','vendas_coleader_edicao_ids','vendas_juridico_certidao_ids','venda_distribuicao_recalcular','trg_venda_distribuicao')
order by 1

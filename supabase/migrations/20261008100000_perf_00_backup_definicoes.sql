-- Itens 1 e 2 da conferência de desempenho — ETAPA 0: cópia de segurança das definições atuais.
-- Guarda, DENTRO do banco, o texto de todas as policies das tabelas de venda e das funções que as etapas 1 e 2
-- alteram, do jeito que estão antes da mudança. Não altera nada do sistema.
-- Idempotente: se o lote já foi gravado, não grava de novo (a cópia continua sendo a do estado ORIGINAL).
-- O desfazer oficial é supabase/rollback/20261008100000_perf_itens_1_2.sql; esta cópia é a segunda via.

create schema if not exists max_backup;
revoke all on schema max_backup from public, anon, authenticated;

create table if not exists max_backup.definicoes (
  lote text not null,
  tipo text not null check (tipo in ('policy', 'function')),
  nome text not null,
  definicao text not null,
  extra jsonb,
  capturado_em timestamptz not null default now(),
  primary key (lote, tipo, nome)
);
revoke all on max_backup.definicoes from public, anon, authenticated;

do $b$
begin
  if exists (select 1 from max_backup.definicoes where lote = '20261008100000') then
    raise notice 'etapa 0: cópia do lote 20261008100000 já existe (mantida)';
    return;
  end if;

  insert into max_backup.definicoes (lote, tipo, nome, definicao, extra)
  select '20261008100000', 'policy', p.tablename || '.' || p.policyname,
         coalesce(p.qual, ''),
         jsonb_build_object('cmd', p.cmd, 'permissive', p.permissive, 'roles', p.roles,
                            'using', p.qual, 'with_check', p.with_check)
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('sales', 'sale_commission_extras', 'occurrences', 'occurrence_commissions',
      'occurrence_partners', 'sale_status_history', 'sale_parties', 'sale_payment', 'sale_documents',
      'sale_comments', 'activity_logs', 'sale_bank_accounts', 'sale_comment_recipients',
      'document_extractions', 'sale_geo');

  insert into max_backup.definicoes (lote, tipo, nome, definicao, extra)
  select '20261008100000', 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid),
         jsonb_build_object('acl', p.proacl::text, 'owner', pg_get_userbyid(p.proowner))
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('dashboard_stats', 'financeiro_distribuicao_vendas', 'calcular_distribuicao_venda',
      'can_view_sale', 'can_read_principal_sale_as_co_leader', 'can_manage_sale_as_co_leader',
      'can_edit_sale_as_co_leader', 'can_read_sale_juridico_certidao', 'is_lead_of', 'is_lead_of_sale_corretor',
      'sale_corretores', 'vendas_comerciais_canonicas', 'comparativo_comissao_6pct',
      'comparativo_comissao_6pct_inconsistencias');

  raise notice 'etapa 0: % definições copiadas',
    (select count(*) from max_backup.definicoes where lote = '20261008100000');
end $b$;

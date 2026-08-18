-- Pedido do usuário: clicar num nome do ranking (Visão Executiva) abre as vendas que compõem a
-- comissão dele. Esta RPC devolve o detalhe linha-a-linha (venda + comissão da pessoa naquela
-- venda), usando EXATAMENTE a mesma janela/regra de "venda fechada" de visao_executiva_stats()
-- (20260819030000) — garante que a soma do detalhe bata sempre com o número mostrado no ranking,
-- sem duplicar a lógica de forma divergente.
--
-- 3 modos de filtro, mutuamente exclusivos (o front-end só passa um por vez):
--   _corretor_id  -> aba "Por corretor": vendas onde essa pessoa tem comissão própria.
--   _team_id      -> aba "Por equipe": vendas de qualquer pessoa que seja team_members dessa equipe
--                    (mesma fonte que ranking_equipe usa pra decidir "de qual equipe é cada um" —
--                    não é "liderada por", é "tem linha em team_members com esse team_id").
--   _sem_equipe   -> aba "Por equipe", grupo "Sem equipe": vendas de gente sem nenhuma linha em
--                    team_members (mesmo critério do "Sem equipe" em ranking_equipe).
create or replace function public.visao_executiva_detalhe_comissao(
  _corretor_id uuid default null,
  _team_id uuid default null,
  _sem_equipe boolean default false
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with fechadas_30d as (
    select distinct on (sale_id) sale_id, created_at as fechado_em
    from sale_status_history
    where para::text in ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')
    order by sale_id, created_at asc
  ),
  vendas_periodo as (
    select f.sale_id, f.fechado_em
    from fechadas_30d f
    join sales s on s.id = f.sale_id
    where f.fechado_em >= now() - interval '30 days'
      and s.status::text not in ('cancelada','arquivada')
  ),
  participantes as (
    select oc.user_id as corretor_id, vp.sale_id, sum(oc.valor) as valor_comissao, vp.fechado_em
    from occurrence_commissions oc
    join occurrences o on o.id = oc.occurrence_id
    join vendas_periodo vp on vp.sale_id = o.sale_id
    where oc.user_id is not null
    group by oc.user_id, vp.sale_id, vp.fechado_em
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_id', s.id,
    'codigo_interno', s.codigo_interno,
    'imovel_id', s.imovel_id,
    'modalidade', s.modalidade,
    'valor_negociado', s.valor_negociado,
    'valor_comissao', p.valor_comissao,
    'fechado_em', p.fechado_em,
    'corretor_id', p.corretor_id
  ) order by p.valor_comissao desc), '[]'::jsonb)
  from participantes p
  join sales s on s.id = p.sale_id
  where
    (_corretor_id is not null and p.corretor_id = _corretor_id)
    or (_team_id is not null and p.corretor_id in (select tm.membro_id from team_members tm where tm.team_id = _team_id))
    or (_sem_equipe and not exists (select 1 from team_members tm where tm.membro_id = p.corretor_id))
$function$;

-- Mesmo padrão de acesso de visao_executiva_stats(): SECURITY INVOKER, sem checagem de papel
-- dentro da função — a RLS de sales/occurrences/occurrence_commissions já restringe o que cada
-- papel pode ver (financeiro/admin/super_admin veem tudo; qualquer outro papel só veria as
-- próprias vendas, se chamasse esta RPC diretamente). A tela só chama isto pra admin/super_admin.
revoke all on function public.visao_executiva_detalhe_comissao(uuid, uuid, boolean) from public;
grant execute on function public.visao_executiva_detalhe_comissao(uuid, uuid, boolean) to authenticated;

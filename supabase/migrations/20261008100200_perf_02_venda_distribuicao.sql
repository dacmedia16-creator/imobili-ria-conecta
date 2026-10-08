-- Itens 1 e 2 da conferência de desempenho — ETAPA 2 (item 1): resultado da distribuição GRAVADO por venda.
--
-- Antes: Painel (dashboard_stats) e Financeiro (financeiro_distribuicao_vendas) chamavam
-- calcular_distribuicao_venda para cada venda a cada abertura de tela. Agora o resultado fica pronto na tabela
-- venda_distribuicao e é atualizado por gatilho sempre que a venda ou algo que entra no cálculo muda
-- (sales, sale_commission_extras, occurrences.sale_id, occurrence_commissions). O CÁLCULO NÃO MUDA: a tabela guarda
-- exatamente o retorno de calcular_distribuicao_venda (função determinística: não usa data/hora nem usuário).
-- As duas telas mantêm o texto atual; só a chamada ao cálculo vira leitura da tabela.
-- Agrupamento por mês da assinatura (America/Sao_Paulo) e recebimentos pela data da parcela: inalterados.
--
-- REGRA FIXA (README "Checklist de migrations"): toda migration que mudar calcular_distribuicao_venda (ou o que
-- ela lê) tem de terminar com  select public.venda_distribuicao_recalcular_todas();  e a conferência
-- select * from public.venda_distribuicao_conferir();  tem de voltar vazia.
--
-- Idempotente: tabela/índice "if not exists", funções "or replace", gatilhos e policies recriados, carga inicial
-- por upsert; as telas só são trocadas se o texto atual for o conferido em produção (ou já o novo).
-- Desfazer: supabase/rollback/20261008100000_perf_itens_1_2.sql.

select set_config('lock_timeout', '5s', true);

create table if not exists public.venda_distribuicao (
  sale_id uuid primary key references public.sales(id) on delete cascade,
  organization_id uuid not null,
  resultado jsonb not null,
  atualizado_em timestamptz not null default now()
);
create index if not exists venda_distribuicao_org_idx on public.venda_distribuicao (organization_id, sale_id);
comment on table public.venda_distribuicao is
  'Resultado gravado de calcular_distribuicao_venda por venda (mantido por gatilho). Não editar à mão: '
  'use venda_distribuicao_recalcular_todas() e confira com venda_distribuicao_conferir().';

alter table public.venda_distribuicao enable row level security;
revoke all on public.venda_distribuicao from public, anon, authenticated, service_role;
grant select on public.venda_distribuicao to authenticated, service_role;

-- Leitura: mesma imobiliária E a pessoa enxerga a venda. Espelha as 3 policies de LEITURA de sales
-- (sales_select, sales_co_leader_principal_read, juridico_returned_sale_read) com as mesmas listas da etapa 1;
-- não há regra nova. Cada lista é calculada uma vez por consulta. O ensaio confere, perfil a perfil, que as
-- vendas visíveis aqui são exatamente as visíveis em sales.
drop policy if exists org_isolation on public.venda_distribuicao;
create policy org_isolation on public.venda_distribuicao as restrictive for all to authenticated
  using (organization_id = (select public.current_org_id()));
drop policy if exists vd_select on public.venda_distribuicao;
create policy vd_select on public.venda_distribuicao for select to authenticated
  using (sale_id in (select public.vendas_visiveis_ids())
      or sale_id in (select public.vendas_coleader_leitura_ids())
      or sale_id in (select public.vendas_juridico_certidao_ids()));

-- Recalcula UMA venda. Trava a linha da venda: duas gravações simultâneas na mesma venda ficam em fila, e a
-- segunda recalcula já enxergando a primeira (evita gravar resultado velho).
create or replace function public.venda_distribuicao_recalcular(_sale_id uuid)
returns void language plpgsql volatile security definer set search_path to ''
as $$
declare v_sale public.sales;
begin
  if _sale_id is null then return; end if;
  select * into v_sale from public.sales where id = _sale_id for update;
  if not found then return; end if;
  insert into public.venda_distribuicao (sale_id, organization_id, resultado, atualizado_em)
  values (v_sale.id, v_sale.organization_id, public.calcular_distribuicao_venda(v_sale), now())
  on conflict (sale_id) do update set resultado = excluded.resultado,
    organization_id = excluded.organization_id, atualizado_em = excluded.atualizado_em
  where venda_distribuicao.resultado is distinct from excluded.resultado
     or venda_distribuicao.organization_id is distinct from excluded.organization_id;
end $$;

-- Recalcula TODAS as vendas (carga inicial e obrigatório após mudar o cálculo). Devolve quantas conferiu.
create or replace function public.venda_distribuicao_recalcular_todas()
returns integer language plpgsql volatile security definer set search_path to ''
as $$
declare n integer;
begin
  insert into public.venda_distribuicao (sale_id, organization_id, resultado, atualizado_em)
  select s.id, s.organization_id, public.calcular_distribuicao_venda(s.*), now() from public.sales s
  on conflict (sale_id) do update set resultado = excluded.resultado,
    organization_id = excluded.organization_id, atualizado_em = excluded.atualizado_em
  where venda_distribuicao.resultado is distinct from excluded.resultado
     or venda_distribuicao.organization_id is distinct from excluded.organization_id;
  select count(*) into n from public.sales;
  return n;
end $$;

-- Conferência (reconciliação): lista as vendas em que o gravado difere do cálculo ao vivo. Vazio = 100%.
create or replace function public.venda_distribuicao_conferir()
returns table (sale_id uuid, situacao text)
language sql stable security definer set search_path to ''
as $$
  select s.id, case when vd.sale_id is null then 'faltando' else 'diferente' end
  from public.sales s
  left join public.venda_distribuicao vd on vd.sale_id = s.id
  where vd.sale_id is null or vd.resultado is distinct from public.calcular_distribuicao_venda(s.*)
  union all
  select vd.sale_id, 'sobrando' from public.venda_distribuicao vd
  where not exists (select 1 from public.sales s where s.id = vd.sale_id)
$$;

revoke all on function public.venda_distribuicao_recalcular(uuid), public.venda_distribuicao_recalcular_todas(),
  public.venda_distribuicao_conferir() from public, anon, authenticated;
grant execute on function public.venda_distribuicao_recalcular_todas(), public.venda_distribuicao_conferir() to service_role;

create or replace function public.trg_venda_distribuicao()
returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if tg_table_name = 'sales' then
    perform public.venda_distribuicao_recalcular(new.id);
  elsif tg_table_name in ('sale_commission_extras', 'occurrences') then
    if tg_op in ('UPDATE', 'DELETE') then perform public.venda_distribuicao_recalcular(old.sale_id); end if;
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.sale_id is distinct from old.sale_id) then
      perform public.venda_distribuicao_recalcular(new.sale_id); end if;
  elsif tg_table_name = 'occurrence_commissions' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public.venda_distribuicao_recalcular((select o.sale_id from public.occurrences o where o.id = old.occurrence_id)); end if;
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.occurrence_id is distinct from old.occurrence_id) then
      perform public.venda_distribuicao_recalcular((select o.sale_id from public.occurrences o where o.id = new.occurrence_id)); end if;
  end if;
  return null;
end $$;
revoke all on function public.trg_venda_distribuicao() from public, anon, authenticated;

-- "zz_" = roda depois dos gatilhos atuais (ordem alfabética), já com os valores finais da gravação.
create or replace trigger zz_venda_distribuicao after insert or update on public.sales
  for each row execute function public.trg_venda_distribuicao();
create or replace trigger zz_venda_distribuicao after insert or update or delete on public.sale_commission_extras
  for each row execute function public.trg_venda_distribuicao();
create or replace trigger zz_venda_distribuicao after insert or update of sale_id or delete on public.occurrences
  for each row execute function public.trg_venda_distribuicao();
create or replace trigger zz_venda_distribuicao after insert or update or delete on public.occurrence_commissions
  for each row execute function public.trg_venda_distribuicao();

-- carga inicial + conferência na mesma transação (se qualquer venda divergir, nada é aplicado)
select public.venda_distribuicao_recalcular_todas();
do $c$
declare n int;
begin
  select count(*) into n from public.venda_distribuicao_conferir();
  if n > 0 then raise exception 'reconciliação falhou: % vendas divergentes após a carga', n; end if;
end $c$;
analyze public.venda_distribuicao;

-- Painel e Financeiro passam a LER o resultado gravado.
-- >>> GERADO
-- public.dashboard_stats(): texto de produção com UMA troca (cálculo ao vivo -> resultado gravado)
do $g$ begin
  if md5((select prosrc from pg_proc where oid = 'public.dashboard_stats()'::regprocedure)) = '9185ad948c467785f4750777ebefcd9a' then
    raise notice 'public.dashboard_stats(): já lê o resultado gravado';
  elsif md5((select prosrc from pg_proc where oid = 'public.dashboard_stats()'::regprocedure)) <> 'f6788b47d9331b8cb7907fef85468110' then
    raise exception 'public.dashboard_stats() diverge da versão conferida em produção; gere o SQL de novo';
  end if;
end $g$;
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
      vd.resultado as resultado
    from occurrences o
    join sales s on s.id = o.sale_id
    join venda_distribuicao vd on vd.sale_id = s.id
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
    join lateral (select vd.resultado as r from venda_distribuicao vd where vd.sale_id = s.id) d on true
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

-- public.financeiro_distribuicao_vendas(): texto de produção com UMA troca (cálculo ao vivo -> resultado gravado)
do $g$ begin
  if md5((select prosrc from pg_proc where oid = 'public.financeiro_distribuicao_vendas()'::regprocedure)) = 'ffaad4a67671f98f8b702122d2128ece' then
    raise notice 'public.financeiro_distribuicao_vendas(): já lê o resultado gravado';
  elsif md5((select prosrc from pg_proc where oid = 'public.financeiro_distribuicao_vendas()'::regprocedure)) <> '87f5f610250097e0fbda9071a6bd3225' then
    raise exception 'public.financeiro_distribuicao_vendas() diverge da versão conferida em produção; gere o SQL de novo';
  end if;
end $g$;
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
  join lateral (
    select vd.resultado from venda_distribuicao vd where vd.sale_id = s.id
  ) d on true
  where s.status::text not in ('cancelada', 'arquivada')
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$function$;
-- <<< GERADO

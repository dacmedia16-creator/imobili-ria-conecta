-- Corrige os quatro resíduos financeiros coordenados sem alterar dados de venda,
-- comissão, cadastro ou ocorrência.
--
-- 1) Mantém o regime de caixa no frontend (data efetiva para recebido).
-- 2) Expõe o saldo de Lançamento pela mesma chave consumida pelo Financeiro.
-- 3) Faz comissão manual da ocorrência (managed_by_sale = false) sair do saldo
--    da imobiliária, sem apagar ou reclassificar a linha.
-- 4) Faz a carteira usar a camada comercial canônica e a distribuição única,
--    que já inclui prêmio em Lançamento.

-- A função por id delega para esta função por row; o patch preserva a definição
-- implantada e falha de forma explícita se a versão do banco tiver divergido.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'calcular_distribuicao_venda'
    and pg_get_function_identity_arguments(p.oid) in ('p_sale sales', 'p_sale public.sales');

  if v_definition is null then
    raise exception 'Função esperada não encontrada: public.calcular_distribuicao_venda(p_sale sales)';
  end if;

  if position('v_comissoes_manuais numeric' in v_definition) > 0 then
    return;
  end if;

  v_updated := replace(
    v_definition,
    $needle$  v_extra_imobiliaria numeric;$needle$,
    $replacement$  v_extra_imobiliaria numeric;
  v_comissoes_manuais numeric;$replacement$
  );
  v_updated := replace(
    v_updated,
    $needle$  v_outros_extras := v_extra_captador + v_extra_vendedor + v_extra_imobiliaria;$needle$,
    $replacement$  select coalesce(sum(oc.valor), 0)
  into v_comissoes_manuais
  from public.occurrence_commissions oc
  join public.occurrences o on o.id = oc.occurrence_id
  where o.sale_id = v_sale.id
    and oc.managed_by_sale is false
    and oc.sale_commission_extra_id is null
    and not coalesce(oc.sem_cadastro_confirmado, false);

  v_outros_extras := v_extra_captador + v_extra_vendedor + v_extra_imobiliaria;$replacement$
  );
  v_updated := replace(
    v_updated,
    $needle$  v_saldo_liquido := v_saldo_inicial - v_gestores_team_leaders - v_extra_imobiliaria;$needle$,
    $replacement$  v_saldo_liquido := v_saldo_inicial - v_gestores_team_leaders - v_extra_imobiliaria - v_comissoes_manuais;$replacement$
  );
  v_updated := replace(
    v_updated,
    $needle$    + v_gestores_team_leaders + v_outros_extras + v_saldo_liquido + v_parceria;$needle$,
    $replacement$    + v_gestores_team_leaders + v_outros_extras + v_comissoes_manuais + v_saldo_liquido + v_parceria;$replacement$
  );
  v_updated := replace(
    v_updated,
    $needle$    'descontos_extra_imobiliaria', v_extra_imobiliaria,$needle$,
    $replacement$    'descontos_extra_imobiliaria', v_extra_imobiliaria,
    'comissoes_manuais_imobiliaria', v_comissoes_manuais,$replacement$
  );

  if position('v_comissoes_manuais numeric' in v_updated) = 0
     or position('oc.managed_by_sale is false' in v_updated) = 0
     or position('v_comissoes_manuais + v_saldo_liquido' in v_updated) = 0
     or position('comissoes_manuais_imobiliaria' in v_updated) = 0 then
    raise exception 'Não foi possível aplicar o patch da comissão manual na definição implantada.';
  end if;

  execute v_updated;
end
$migration$;

-- Mantém o overload usado pelo PostgREST como um delegador simples; assim a
-- chamada por UUID e a chamada interna por row compartilham a mesma fórmula.
create or replace function public.calcular_distribuicao_venda(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_sale public.sales%rowtype;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    return jsonb_build_object(
      'inconsistencias', jsonb_build_array('Venda não encontrada.'),
      'calculo_valido', false
    );
  end if;
  return public.calcular_distribuicao_venda(v_sale);
end;
$function$;

-- Contrato único para a receita líquida por venda: Lançamento usa
-- saldo_imobiliaria; venda padrão usa saldo_liquido_imobiliaria.
create or replace function public.financeiro_distribuicao_vendas()
returns table (
  sale_id uuid,
  saldo_inicial_imobiliaria numeric,
  saldo_liquido_imobiliaria numeric
)
language sql
stable
security invoker
set search_path = public
as $function$
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

revoke execute on function public.financeiro_distribuicao_vendas() from public, anon;
grant execute on function public.financeiro_distribuicao_vendas() to authenticated;

revoke execute on function public.calcular_distribuicao_venda(public.sales) from public, anon;
revoke execute on function public.calcular_distribuicao_venda(uuid) from public, anon;
grant execute on function public.calcular_distribuicao_venda(public.sales) to authenticated;
grant execute on function public.calcular_distribuicao_venda(uuid) to authenticated;

-- Carteira por período: seleção comercial canônica e líquido calculado pela
-- mesma RPC das telas de venda/dashboard. O prêmio de Lançamento entra no
-- saldo_imobiliaria retornado pela distribuição, sem duplicar fórmula aqui.
create or replace function public.comissoes_carteira_periodo(_de date, _ate date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  with efetivadas as (
    select sale_id, venda_em as efetivada_em
    from public.vendas_comerciais_canonicas()
  ),
  parceria as (
    select occurrence_id, sum(valor) as valor
    from (
      select occurrence_id, coalesce(valor, 0) as valor
      from public.occurrence_partners
      union all
      select occurrence_id, coalesce(valor, 0) as valor
      from public.occurrence_commissions
      where sem_cadastro_confirmado
    ) x
    group by occurrence_id
  )
  select jsonb_build_object(
    'comissao_prevista_total', coalesce(sum(greatest(o.valor_comissao - coalesce(p.valor, 0), 0)) filter (where o.status <> 'concluida'), 0),
    'comissao_concluida_total', coalesce(sum(greatest(o.valor_comissao - coalesce(p.valor, 0), 0)) filter (where o.status = 'concluida'), 0),
    'comissao_parceria_externa_prevista_total', coalesce(sum(coalesce(p.valor, 0)) filter (where o.status <> 'concluida'), 0),
    'comissao_parceria_externa_concluida_total', coalesce(sum(coalesce(p.valor, 0)) filter (where o.status = 'concluida'), 0),
    'liquido_imobiliaria_prevista_total', coalesce(sum(coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )) filter (where o.status <> 'concluida'), 0),
    'liquido_imobiliaria_concluida_total', coalesce(sum(coalesce(
      (d.resultado->>'saldo_liquido_imobiliaria')::numeric,
      (d.resultado->>'saldo_imobiliaria')::numeric,
      0
    )) filter (where o.status = 'concluida'), 0),
    'comissao_por_corretor', coalesce((select jsonb_object_agg(user_id, total) from (
      select oc.user_id::text as user_id, sum(oc.valor) as total
      from public.occurrence_commissions oc
      join public.occurrences oi on oi.id = oc.occurrence_id
      join efetivadas ei on ei.sale_id = oi.sale_id
      join public.sales si on si.id = oi.sale_id
      where oc.user_id is not null
        and not coalesce(oc.sem_cadastro_confirmado, false)
        and si.status::text not in ('cancelada','arquivada')
        and ei.efetivada_em >= _de::timestamptz
        and ei.efetivada_em < (_ate + 1)::timestamptz
      group by oc.user_id
    ) q), '{}'::jsonb)
  )
  from public.occurrences o
  join efetivadas e on e.sale_id = o.sale_id
  join public.sales s on s.id = o.sale_id
  cross join lateral (
    select public.calcular_distribuicao_venda(s.*) as resultado
  ) d
  left join parceria p on p.occurrence_id = o.id
  where _de <= _ate
    and e.efetivada_em >= _de::timestamptz
    and e.efetivada_em < (_ate + 1)::timestamptz
    and s.status::text not in ('cancelada','arquivada')
    and public.has_any_role(
      auth.uid(),
      array['financeiro','admin','super_admin']::public.app_role[]
    );
$function$;

revoke execute on function public.comissoes_carteira_periodo(date, date) from public, anon;
grant execute on function public.comissoes_carteira_periodo(date, date) to authenticated;

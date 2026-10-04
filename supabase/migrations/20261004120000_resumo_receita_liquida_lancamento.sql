-- Resumo da Operação: Lançamento entra igual à venda padrão.
-- calcular_distribuicao_venda devolve no Lançamento apenas 'saldo_imobiliaria' (sobra final da imobiliária).
--  * Receita líquida: usa 'saldo_imobiliaria' quando 'saldo_liquido_imobiliaria' não existe.
--  * Comissão destinada à unidade: no padrão é o que sobra após pagar corretores (antes de gestor/TL/extras);
--    no Lançamento = saldo_imobiliaria + participações que não são de corretor (team leader, coordenação, outros).
CREATE OR REPLACE FUNCTION public.resumo_desempenho_periodo(_de date, _ate date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with base as (
    select
      s.id,
      greatest(coalesce(s.valor_negociado, 0), 0) as vgv,
      greatest(coalesce((d.valor->>'comissao_bruta')::numeric, 0), 0) as comissao_bruta,
      greatest(coalesce((d.valor->>'parceria_externa')::numeric, 0), 0) as parceria_externa,
      greatest(coalesce(
        (d.valor->>'saldo_inicial_imobiliaria')::numeric,
        case when d.valor ? 'saldo_imobiliaria' then
          (d.valor->>'saldo_imobiliaria')::numeric
          + coalesce((select sum(e.valor) from public.sale_commission_extras e
                      where e.sale_id = s.id and e.papel::text <> 'corretor_vendedor'), 0)
        end,
        0), 0) as parte_unidade,
      greatest(coalesce((d.valor->>'saldo_liquido_imobiliaria')::numeric, (d.valor->>'saldo_imobiliaria')::numeric, 0), 0) as receita_liquida
    from public.vendas_comerciais_canonicas() v
    join sales s on s.id = v.sale_id
    cross join lateral (select public.calcular_distribuicao_venda(s.id) as valor) d
    where v.venda_em >= (_de::timestamp at time zone 'America/Sao_Paulo')
      and v.venda_em < ((_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), propria as (
    select *,
      greatest(comissao_bruta - parceria_externa, 0) as comissao_propria,
      case when comissao_bruta > 0 then
        vgv * least(greatest(comissao_bruta - parceria_externa, 0) / comissao_bruta, 1)
      else 0 end as vgv_proprio
    from base
  )
  select jsonb_build_object(
    'vgv_proprio', coalesce(sum(vgv_proprio), 0),
    'comissao_propria', coalesce(sum(comissao_propria), 0),
    'parte_unidade', coalesce(sum(parte_unidade), 0),
    'receita_liquida_imobiliaria', coalesce(sum(receita_liquida), 0),
    'quantidade_vendas', count(*)
  )
  from propria
  where _de <= _ate
    and has_any_role(auth.uid(), array['financeiro','admin','super_admin','gestor','team_leader']::app_role[]);
$function$;

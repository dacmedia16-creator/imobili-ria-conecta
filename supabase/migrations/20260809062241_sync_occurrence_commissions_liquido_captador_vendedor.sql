-- occurrence_commissions.valor pra corretor_captador/corretor_vendedor gravava o valor BRUTO
-- (sales.valor_comissao_captador/vendedor) mesmo quando havia indicador ou extra com origem
-- captador/vendedor descontando dali — a linha do indicador existia À PARTE, com seu próprio
-- valor. Somar as duas linhas (como relatorios.tsx > aba Comissões faz) contava o indicador em
-- dobro: uma vez na linha dele, outra embutida no bruto do captador/vendedor. Agora usa
-- calcular_distribuicao_venda() (fonte única, ver migration 20260809030000) pra gravar o LÍQUIDO
-- (bruto - indicador - extras de mesma origem) nessas duas linhas — o resto do sync não muda.
create or replace function public.sync_occurrence_commissions(_sale_id uuid)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_occ_id uuid;
  v_total numeric;
  v_sale sales%rowtype;
  v_dist jsonb;
  v_pct numeric;
  v_fixed record;
  v_extra record;
begin
  select id, valor_comissao into v_occ_id, v_total from occurrences where sale_id = _sale_id;
  if v_occ_id is null then
    return;
  end if;

  select * into v_sale from sales where id = _sale_id;
  v_dist := calcular_distribuicao_venda(_sale_id);

  -- valor_bruto decide se a linha existe/some (mesma regra de sempre: nome+valor+user_id todos
  -- nulos = removido no Resumo) e entra no cálculo do percentual; valor_final é o que de fato é
  -- gravado. Só captador/vendedor diferem entre os dois (líquido vs bruto) — os demais papéis
  -- nunca tiveram nada descontado deles mesmos, então valor_final = valor_bruto igual antes.
  for v_fixed in
    select * from (values
      ('corretor_captador', v_sale.corretor_captador, v_sale.valor_comissao_captador, (v_dist->>'liquido_captador')::numeric, v_sale.corretor_captador_id),
      ('corretor_vendedor', v_sale.corretor_vendedor, v_sale.valor_comissao_vendedor, (v_dist->>'liquido_vendedor')::numeric, v_sale.corretor_vendedor_id),
      ('indicador_captador', v_sale.indicador_captador, v_sale.valor_comissao_indicador_captador, v_sale.valor_comissao_indicador_captador, null::uuid),
      ('indicador_vendedor', v_sale.indicador_vendedor, v_sale.valor_comissao_indicador_vendedor, v_sale.valor_comissao_indicador_vendedor, null::uuid),
      ('lider_captador', v_sale.lider_captador_nome, v_sale.valor_comissao_lider_captador, v_sale.valor_comissao_lider_captador, v_sale.lider_captador_id),
      ('lider_vendedor', v_sale.lider_vendedor_nome, v_sale.valor_comissao_lider_vendedor, v_sale.valor_comissao_lider_vendedor, v_sale.lider_vendedor_id)
    ) as t(papel, nome, valor_bruto, valor_final, user_id)
  loop
    if v_fixed.nome is null and v_fixed.valor_bruto is null and v_fixed.user_id is null then
      delete from occurrence_commissions
      where occurrence_id = v_occ_id and papel = v_fixed.papel and sale_commission_extra_id is null;
    else
      v_pct := case when v_fixed.valor_final is not null and v_total > 0 then round((v_fixed.valor_final / v_total) * 100, 3) else null end;
      update occurrence_commissions
      set nome = v_fixed.nome, valor = v_fixed.valor_final, percentual = v_pct, user_id = v_fixed.user_id
      where occurrence_id = v_occ_id and papel = v_fixed.papel and sale_commission_extra_id is null;
      if not found then
        insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, user_id)
        values (v_occ_id, v_fixed.papel, v_fixed.nome, v_fixed.valor_final, v_pct, v_fixed.user_id);
      end if;
    end if;
  end loop;

  for v_extra in
    select
      m.id as extra_id, m.papel, m.nome, m.valor,
      coalesce(m.user_id_raw,
        case m.papel when 'gestor' then v_sale.coordenador_id when 'team_leader' then v_sale.team_leader_id else null end
      ) as user_id
    from (
      select e.id, e.nome, e.valor, e.user_id as user_id_raw,
        case when e.papel in ('gestor','team_leader','outro','corretor_captador','corretor_vendedor') then e.papel else 'outro' end as papel
      from sale_commission_extras e
      where e.sale_id = _sale_id
    ) m
  loop
    v_pct := case when v_extra.valor is not null and v_total > 0 then round((v_extra.valor / v_total) * 100, 3) else null end;
    update occurrence_commissions
    set nome = v_extra.nome, valor = v_extra.valor, percentual = v_pct, papel = v_extra.papel, user_id = v_extra.user_id
    where occurrence_id = v_occ_id and sale_commission_extra_id = v_extra.extra_id;
    if not found then
      insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, sale_commission_extra_id, user_id)
      values (v_occ_id, v_extra.papel, v_extra.nome, v_extra.valor, v_pct, v_extra.extra_id, v_extra.user_id);
    end if;
  end loop;

  delete from occurrence_commissions oc
  where oc.occurrence_id = v_occ_id
    and oc.sale_commission_extra_id is not null
    and not exists (select 1 from sale_commission_extras e where e.id = oc.sale_commission_extra_id);
end;
$function$;

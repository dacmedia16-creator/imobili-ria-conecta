-- syncOccurrenceCommissions() no cliente só fazia insert/update das comissões vindas do Resumo
-- (papéis fixos e sale_commission_extras), nunca delete — uma pessoa removida no Resumo (outro
-- captador/vendedor, indicador, líder) continuava com a linha antiga em occurrence_commissions,
-- aparecendo em relatórios e recebendo comissão mesmo depois de removida. Move a sincronização
-- pro banco, transacional: qualquer falha no meio do caminho desfaz tudo (evita sync parcial).
--
-- Papéis fixos (1 linha por venda, sale_commission_extra_id IS NULL): se nome, valor e user_id
-- ficaram todos nulos no Resumo, a linha é apagada; senão é upsert (update se já existir, senão
-- insert). O filtro "sale_commission_extra_id IS NULL" no match evita confundir a linha fixa de
-- corretor_captador/vendedor com um "outro captador/vendedor" extra que usa o mesmo papel.
--
-- Partes extras (sale_commission_extras): upsert por sale_commission_extra_id (vínculo estável,
-- sobrevive a mudança de nome). Depois do upsert, qualquer linha de occurrence_commissions com
-- sale_commission_extra_id que não existe mais em sale_commission_extras é apagada — é exatamente
-- essa exclusão que faltava.
--
-- Linhas financeiras manuais da Ocorrência (sem sale_commission_extra_id e sem papel fixo, ou com
-- papel fixo mas id de linha diferente da que este RPC gerencia) nunca são tocadas aqui.
create or replace function public.sync_occurrence_commissions(_sale_id uuid)
returns void
language plpgsql
security invoker
set search_path = 'public'
as $function$
declare
  v_occ_id uuid;
  v_total numeric;
  v_sale sales%rowtype;
  v_pct numeric;
  v_fixed record;
  v_extra record;
begin
  select id, valor_comissao into v_occ_id, v_total from occurrences where sale_id = _sale_id;
  if v_occ_id is null then
    return;
  end if;

  select * into v_sale from sales where id = _sale_id;

  for v_fixed in
    select * from (values
      ('corretor_captador', v_sale.corretor_captador, v_sale.valor_comissao_captador, v_sale.corretor_captador_id),
      ('corretor_vendedor', v_sale.corretor_vendedor, v_sale.valor_comissao_vendedor, v_sale.corretor_vendedor_id),
      ('indicador_captador', v_sale.indicador_captador, v_sale.valor_comissao_indicador_captador, null::uuid),
      ('indicador_vendedor', v_sale.indicador_vendedor, v_sale.valor_comissao_indicador_vendedor, null::uuid),
      ('lider_captador', v_sale.lider_captador_nome, v_sale.valor_comissao_lider_captador, v_sale.lider_captador_id),
      ('lider_vendedor', v_sale.lider_vendedor_nome, v_sale.valor_comissao_lider_vendedor, v_sale.lider_vendedor_id)
    ) as t(papel, nome, valor, user_id)
  loop
    if v_fixed.nome is null and v_fixed.valor is null and v_fixed.user_id is null then
      delete from occurrence_commissions
      where occurrence_id = v_occ_id and papel = v_fixed.papel and sale_commission_extra_id is null;
    else
      v_pct := case when v_fixed.valor is not null and v_total > 0 then round((v_fixed.valor / v_total) * 100, 3) else null end;
      update occurrence_commissions
      set nome = v_fixed.nome, valor = v_fixed.valor, percentual = v_pct, user_id = v_fixed.user_id
      where occurrence_id = v_occ_id and papel = v_fixed.papel and sale_commission_extra_id is null;
      if not found then
        insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, user_id)
        values (v_occ_id, v_fixed.papel, v_fixed.nome, v_fixed.valor, v_pct, v_fixed.user_id);
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

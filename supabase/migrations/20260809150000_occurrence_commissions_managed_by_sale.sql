-- PROBLEMA (achado #4, aprofundado numa segunda rodada de auditoria): a correção anterior só ajustou
-- o casamento de linha no FRONT-END (pullFromSaleSplit, papel+nome -> sale_commission_extra_id). A
-- RPC sync_occorrence_commissions em si ainda identificava as linhas "fixas" (captador/vendedor/
-- indicador/líder) só por (occurrence_id, papel, sale_commission_extra_id is null) — se o financeiro
-- adicionar uma linha manual na Ocorrência (botão "Adicionar", papel padrão 'corretor_vendedor', sem
-- sale_commission_extra_id) com o mesmo papel de uma linha fixa da venda, essa linha manual podia ser
-- silenciosamente atualizada/apagada pela RPC no próximo save da Resumo, mesmo sem nenhuma relação
-- real com a venda.
--
-- Correção: coluna técnica managed_by_sale (boolean, não deriva de nome) marca se a linha é gerenciada
-- automaticamente (Resumo/sale_commission_extras, via sync_occurrence_commissions ou pullFromSaleSplit)
-- ou manual (criada pelo financeiro direto na Ocorrência, botão "Adicionar" — sempre managed_by_sale
-- = false). A RPC só atualiza/apaga linhas com managed_by_sale = true; se não achar (porque a única
-- linha daquele papel é manual), cria uma nova linha gerenciada ao lado — pior caso vira duplicata
-- visível, nunca sobrescrita/exclusão silenciosa de linha manual.
--
-- BACKFILL: DEFAULT false na coluna nova (mais conservador — nunca soltar sem querer o cadeado de uma
-- linha por engano), com UPDATE explícito marcando managed_by_sale = true para as linhas que JÁ
-- eram geridas pela RPC até aqui — auditado antes de rodar: 11 linhas existentes no total, 1 com
-- sale_commission_extra_id preenchido e 10 com papel fixo e sale_commission_extra_id nulo,
-- 0 linhas ambíguas (nenhuma correspondia a um papel fora do conjunto gerenciado). As 11 foram
-- inspecionadas manualmente antes do backfill e batem com nome/valor esperados da venda de origem —
-- nenhum registro apagado ou reclassificado por nome, só marcado como já era o comportamento
-- implícito até agora.
alter table public.occurrence_commissions add column if not exists managed_by_sale boolean not null default false;

update public.occurrence_commissions
set managed_by_sale = true
where sale_commission_extra_id is not null
   or papel in ('corretor_captador', 'corretor_vendedor', 'indicador_captador', 'indicador_vendedor', 'lider_captador', 'lider_vendedor');

-- No máximo 1 linha GERENCIADA por papel fixo por ocorrência — não restringe linhas manuais
-- (managed_by_sale = false) nem linhas de extras (sale_commission_extra_id sempre preenchido, cada
-- uma já é naturalmente única pelo id da parte extra de origem).
create unique index if not exists occurrence_commissions_managed_fixed_papel_key
  on public.occurrence_commissions (occurrence_id, papel)
  where sale_commission_extra_id is null and managed_by_sale = true;

create or replace function public.sync_occurrence_commissions(_sale_id uuid)
 returns void
 language plpgsql
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
      where occurrence_id = v_occ_id and papel = v_fixed.papel and sale_commission_extra_id is null and managed_by_sale = true;
    else
      v_pct := case when v_fixed.valor_final is not null and v_total > 0 then round((v_fixed.valor_final / v_total) * 100, 3) else null end;
      update occurrence_commissions
      set nome = v_fixed.nome, valor = v_fixed.valor_final, percentual = v_pct, user_id = v_fixed.user_id
      where occurrence_id = v_occ_id and papel = v_fixed.papel and sale_commission_extra_id is null and managed_by_sale = true;
      if not found then
        -- Não achou linha GERENCIADA pra atualizar — ou é a primeira sincronização (cria normal), ou
        -- a única linha existente daquele papel é manual (managed_by_sale = false, protegida acima):
        -- nesse caso cria uma linha gerenciada nova ao lado dela, em vez de tocar na manual.
        insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, user_id, managed_by_sale)
        values (v_occ_id, v_fixed.papel, v_fixed.nome, v_fixed.valor_final, v_pct, v_fixed.user_id, true);
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
    -- Casamento por sale_commission_extra_id já é inequívoco (nunca colide com linha manual, que
    -- nunca tem esse id preenchido) — managed_by_sale aqui é só consistência de dado, não proteção.
    update occurrence_commissions
    set nome = v_extra.nome, valor = v_extra.valor, percentual = v_pct, papel = v_extra.papel, user_id = v_extra.user_id, managed_by_sale = true
    where occurrence_id = v_occ_id and sale_commission_extra_id = v_extra.extra_id;
    if not found then
      insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, sale_commission_extra_id, user_id, managed_by_sale)
      values (v_occ_id, v_extra.papel, v_extra.nome, v_extra.valor, v_pct, v_extra.extra_id, v_extra.user_id, true);
    end if;
  end loop;

  delete from occurrence_commissions oc
  where oc.occurrence_id = v_occ_id
    and oc.sale_commission_extra_id is not null
    and not exists (select 1 from sale_commission_extras e where e.id = oc.sale_commission_extra_id);
end;
$function$;

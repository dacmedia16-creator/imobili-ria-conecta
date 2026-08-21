-- PEDIDO: a tela Equipe (Resumo da venda) só permite 1 Gestor/Team Leader por lado (lider_captador_id/
-- lider_vendedor_id) — usuário quer poder adicionar mais de um por lado (ex.: dois Team Leaders
-- diferentes acompanhando o mesmo captador). O mecanismo pra "mais um" já existe (sale_commission_extras
-- com papel 'gestor'/'team_leader', usado hoje só na etapa Divisão de comissão via addLider()), mas é
-- genérico — não registra de qual lado (captador/vendedor) aquele líder extra é, então não dava pra
-- separar visualmente por card na tela Equipe nem contar certo em ranking de equipe/produção por
-- pessoa depois.
--
-- Adiciona `lado` (nullable — só é preenchido pra papel 'gestor'/'team_leader'; as demais linhas de
-- sale_commission_extras não precisam, o papel já diz o lado) nas duas tabelas que guardam essas
-- linhas, e propaga na sincronização venda -> ocorrência. Não muda nada do CÁLCULO de comissão
-- (calcular_distribuicao_venda): gestor/team leader extra sempre sai do saldo da imobiliária,
-- independente do lado — `lado` é só atribuição/exibição, igual lider_captador_id/lider_vendedor_id
-- já são hoje (também nunca mudam de onde o dinheiro sai, só marcam de qual time é a pessoa).
alter table public.sale_commission_extras
  add column if not exists lado text
  check (lado is null or lado in ('captador', 'vendedor'));

alter table public.occurrence_commissions
  add column if not exists lado text
  check (lado is null or lado in ('captador', 'vendedor'));

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
        insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, user_id, managed_by_sale)
        values (v_occ_id, v_fixed.papel, v_fixed.nome, v_fixed.valor_final, v_pct, v_fixed.user_id, true);
      end if;
    end if;
  end loop;

  for v_extra in
    select
      m.id as extra_id, m.papel, m.nome, m.valor, m.sem_cadastro_confirmado, m.lado,
      coalesce(m.user_id_raw,
        case m.papel when 'gestor' then v_sale.coordenador_id when 'team_leader' then v_sale.team_leader_id else null end
      ) as user_id
    from (
      select e.id, e.nome, e.valor, e.user_id as user_id_raw, e.sem_cadastro_confirmado, e.lado,
        case when e.papel in ('gestor','team_leader','outro','corretor_captador','corretor_vendedor') then e.papel else 'outro' end as papel
      from sale_commission_extras e
      where e.sale_id = _sale_id
    ) m
  loop
    v_pct := case when v_extra.valor is not null and v_total > 0 then round((v_extra.valor / v_total) * 100, 3) else null end;
    update occurrence_commissions
    set nome = v_extra.nome, valor = v_extra.valor, percentual = v_pct, papel = v_extra.papel, user_id = v_extra.user_id, managed_by_sale = true, sem_cadastro_confirmado = v_extra.sem_cadastro_confirmado, lado = v_extra.lado
    where occurrence_id = v_occ_id and sale_commission_extra_id = v_extra.extra_id;
    if not found then
      insert into occurrence_commissions (occurrence_id, papel, nome, valor, percentual, sale_commission_extra_id, user_id, managed_by_sale, sem_cadastro_confirmado, lado)
      values (v_occ_id, v_extra.papel, v_extra.nome, v_extra.valor, v_pct, v_extra.extra_id, v_extra.user_id, true, v_extra.sem_cadastro_confirmado, v_extra.lado);
    end if;
  end loop;

  delete from occurrence_commissions oc
  where oc.occurrence_id = v_occ_id
    and oc.sale_commission_extra_id is not null
    and not exists (select 1 from sale_commission_extras e where e.id = oc.sale_commission_extra_id);
end;
$function$;

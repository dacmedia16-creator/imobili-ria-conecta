-- Lançamento: percentual e valor individual precisam representar a mesma fatia da
-- comissão bruta + prêmio. A tolerância de R$ 0,50 preserva arredondamentos legados;
-- a interface nova grava sempre com duas casas e normalmente diverge no máximo R$ 0,01.
create or replace function public.validar_percentual_valor_comissao_lancamento()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_base numeric;
  v_esperado numeric;
begin
  select * into v_sale from public.sales where id = new.sale_id;
  if not found or v_sale.modalidade <> 'lancamento' then
    return new;
  end if;

  if new.percentual is null or new.valor is null then
    return new;
  end if;

  v_base := coalesce(
    v_sale.valor_total_comissao,
    case
      when v_sale.percentual_comissao is not null and v_sale.valor_negociado is not null
        then round(v_sale.valor_negociado * v_sale.percentual_comissao / 100, 2)
      else 0
    end,
    0
  ) + coalesce(v_sale.premio_valor, 0);

  if v_base <= 0 then
    return new;
  end if;

  v_esperado := round(v_base * new.percentual / 100, 2);
  if abs(v_esperado - new.valor) > 0.50 then
    raise exception 'Percentual e valor divergentes: %%% corresponde a R$ %, não a R$ %.',
      new.percentual, v_esperado, new.valor
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validar_percentual_valor_comissao_lancamento
  on public.sale_commission_extras;
create trigger trg_validar_percentual_valor_comissao_lancamento
before insert or update of percentual, valor, sale_id
on public.sale_commission_extras
for each row execute function public.validar_percentual_valor_comissao_lancamento();

-- Correção pontual confirmada: os valores já representam 22,5% para cada vendedora.
-- Altera somente o percentual da fonte e do espelho da ocorrência.
update public.sale_commission_extras
set percentual = 22.5
where sale_id = '5ef1612f-3a48-45d0-8dba-00c06945b7a8'::uuid
  and papel = 'corretor_vendedor'
  and nome in ('Giovana Moretti', 'Giulia Moretti')
  and percentual = 45
  and valor = 2879;

update public.occurrence_commissions
set percentual = 22.5
where occurrence_id = '860257f8-9f64-45f1-8588-5170bf2acece'::uuid
  and papel = 'corretor_vendedor'
  and nome in ('Giovana Moretti', 'Giulia Moretti')
  and percentual = 45
  and valor = 2879;

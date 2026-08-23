-- Correção histórica autorizada por Denis em 2026-08-23.
-- Vincula somente os cinco extras auditados aos perfis ativos já usados nas
-- occurrence_commissions correspondentes. Não altera valores, percentuais,
-- papéis, status ou qualquer outro campo financeiro.

begin;

do $block$
declare
  v_gustavo uuid := '12c887f7-dd5c-44f5-91f3-cfd875dc7c50';
  v_virginia uuid := 'e8f6eb73-510b-404e-bbef-53cd4bc4742e';
  v_count integer;
  v_total numeric;
begin
  if not exists (select 1 from public.profiles where id = v_gustavo and ativo and trim(nome) = 'Gustavo Fuentes') then
    raise exception 'Perfil ativo de Gustavo Fuentes não confere.';
  end if;
  if not exists (select 1 from public.profiles where id = v_virginia and ativo and trim(nome) = 'Virginia Aranha') then
    raise exception 'Perfil ativo de Virginia Aranha não confere.';
  end if;

  select count(*), sum(valor) into v_count, v_total
  from public.sale_commission_extras
  where id in (
    'b80fe8ff-ba06-48e0-8a33-9835c6cf8c2c',
    'ed6d2939-7161-46dd-9602-3bbf7af2455e',
    '53de9d75-0d7c-48b3-9ee7-15cea0e76b23',
    '4b2220bf-ae94-492e-bf79-7041352cb268',
    '6ddf5d5d-88bf-46ad-9664-f5de1d340158'
  ) and user_id is null;

  if v_count <> 5 or abs(v_total - 23202.25) > 0.01 then
    raise exception 'Pré-condição financeira não confere: % linhas, total %.', v_count, v_total;
  end if;

  update public.sale_commission_extras
  set user_id = v_gustavo
  where id in (
    'b80fe8ff-ba06-48e0-8a33-9835c6cf8c2c',
    'ed6d2939-7161-46dd-9602-3bbf7af2455e',
    '53de9d75-0d7c-48b3-9ee7-15cea0e76b23',
    '4b2220bf-ae94-492e-bf79-7041352cb268'
  ) and user_id is null;
  get diagnostics v_count = row_count;
  if v_count <> 4 then raise exception 'Esperadas 4 linhas de Gustavo; alteradas %.', v_count; end if;

  update public.sale_commission_extras
  set user_id = v_virginia
  where id = '6ddf5d5d-88bf-46ad-9664-f5de1d340158' and user_id is null;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Esperada 1 linha de Virginia; alteradas %.', v_count; end if;
end;
$block$;

commit;


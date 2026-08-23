-- Reversão exata da correção histórica de 2026-08-23.
-- Só remove o vínculo se ele ainda aponta para os perfis auditados.

begin;

update public.sale_commission_extras
set user_id = null
where id in (
  'b80fe8ff-ba06-48e0-8a33-9835c6cf8c2c',
  'ed6d2939-7161-46dd-9602-3bbf7af2455e',
  '53de9d75-0d7c-48b3-9ee7-15cea0e76b23',
  '4b2220bf-ae94-492e-bf79-7041352cb268'
) and user_id = '12c887f7-dd5c-44f5-91f3-cfd875dc7c50';

update public.sale_commission_extras
set user_id = null
where id = '6ddf5d5d-88bf-46ad-9664-f5de1d340158'
  and user_id = 'e8f6eb73-510b-404e-bbef-53cd4bc4742e';

commit;


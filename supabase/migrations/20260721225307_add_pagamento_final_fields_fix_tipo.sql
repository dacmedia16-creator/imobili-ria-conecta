-- Recuperado de supabase_migrations.schema_migrations (versão 20260721225307) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).


alter table public.sale_payment
  add column if not exists pagamento_final_valor numeric,
  add column if not exists pagamento_final_data date;

alter table public.sale_payment drop constraint if exists sale_payment_tipo_pagamento_check;
alter table public.sale_payment
  add constraint sale_payment_tipo_pagamento_check check (tipo_pagamento in ('vista', 'financiamento'));

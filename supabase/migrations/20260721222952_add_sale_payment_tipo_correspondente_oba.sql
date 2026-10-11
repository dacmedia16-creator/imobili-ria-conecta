-- Recuperado de supabase_migrations.schema_migrations (versão 20260721222952) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).


alter table public.sale_payment
  add column if not exists tipo_pagamento text not null default 'vista' check (tipo_pagamento in ('vista', 'financiamento', 'pagamento_final')),
  add column if not exists financiamento_correspondente text,
  add column if not exists oba_credito boolean not null default false;

-- Mantem o boolean "financiamento" (ja usado em varios lugares) sincronizado com o novo tipo_pagamento.
update public.sale_payment set tipo_pagamento = 'financiamento' where financiamento = true and tipo_pagamento = 'vista';

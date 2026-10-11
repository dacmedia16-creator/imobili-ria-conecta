-- Recuperado de supabase_migrations.schema_migrations (versão 20260720003547) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Guarda o banco financiador quando a forma de pagamento é "Financiamento", selecionada no Resumo da venda.
alter table public.sales add column forma_pagamento_banco text;

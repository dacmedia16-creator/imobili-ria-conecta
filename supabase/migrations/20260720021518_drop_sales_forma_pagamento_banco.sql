-- Recuperado de supabase_migrations.schema_migrations (versão 20260720021518) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Revertido: "Forma de pagamento" voltou a ser texto livre (descreve como o proprietário
-- paga a comissão, não um financiamento de imóvel), então o campo de banco não faz mais sentido.
alter table public.sales drop column if exists forma_pagamento_banco;

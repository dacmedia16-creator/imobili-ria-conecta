-- Recuperado de supabase_migrations.schema_migrations (versão 20260720005108) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Endereço da parte (comprador/vendedor), extraído do documento "Comprovante de endereço".
alter table public.sale_parties add column endereco text;

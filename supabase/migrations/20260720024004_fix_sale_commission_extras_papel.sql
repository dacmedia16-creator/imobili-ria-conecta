-- Recuperado de supabase_migrations.schema_migrations (versão 20260720024004) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Corrige o desenho anterior: "origem" é de qual fatia o dinheiro sai (imobiliária/captador/vendedor)
-- e "papel" é quem a pessoa é (gestor/team_leader/outro) — são conceitos independentes.
alter table public.sale_commission_extras drop constraint if exists sale_commission_extras_origem_check;
alter table public.sale_commission_extras add constraint sale_commission_extras_origem_check
  check (origem in ('imobiliaria', 'captador', 'vendedor'));

alter table public.sale_commission_extras add column papel text
  check (papel is null or papel in ('gestor', 'team_leader', 'outro'));

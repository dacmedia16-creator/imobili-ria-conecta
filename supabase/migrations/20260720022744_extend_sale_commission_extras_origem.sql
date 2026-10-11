-- Recuperado de supabase_migrations.schema_migrations (versão 20260720022744) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Adiciona Gestor, Team Leader e Outro como origens possíveis das partes extras da comissão
-- (essas usam o valor total da comissão como base do %, calculado no front-end).
alter table public.sale_commission_extras drop constraint if exists sale_commission_extras_origem_check;
alter table public.sale_commission_extras add constraint sale_commission_extras_origem_check
  check (origem in ('imobiliaria', 'captador', 'vendedor', 'gestor', 'team_leader', 'outro'));

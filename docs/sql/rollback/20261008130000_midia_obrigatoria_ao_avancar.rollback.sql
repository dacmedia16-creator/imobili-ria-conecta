-- Reverte 20261008130000_midia_obrigatoria_ao_avancar.sql: volta a permitir avançar sem mídia.
-- Não mexe em dados (a migration também não mexeu).
drop trigger if exists trg_bloquear_avanco_a_midia on public.sales;
drop function if exists public.bloquear_avanco_sem_midia();
delete from supabase_migrations.schema_migrations where version = '20261008130000';

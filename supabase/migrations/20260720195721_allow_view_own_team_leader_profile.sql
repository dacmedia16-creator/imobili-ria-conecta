-- Recuperado de supabase_migrations.schema_migrations (versão 20260720195721) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

drop policy if exists "profiles_self_select" on public.profiles;

create policy "profiles_self_select" on public.profiles
for select
using (
  id = auth.uid()
  or public.has_any_role(auth.uid(), array['gestor','juridico','financeiro','admin','super_admin']::public.app_role[])
  or exists (
    select 1 from public.team_members tm
    where tm.membro_id = auth.uid() and tm.lider_id = profiles.id
  )
);

-- Login só com Google (cartão t_bcc382de, aprovado por Denis em 12/10/2026, opção a: ADM e Estudo).
-- Rollback: supabase/rollback/20261012170000_login_so_google.sql
--
-- Como funciona: hook "Custom Access Token" do Supabase Auth (plano grátis). Toda vez que o Auth vai emitir
-- uma sessão (login ou renovação), chama public.login_so_google_hook. Se a sessão nasceu de SENHA
-- (authentication_method='password' ou amr com method='password'), a emissão é recusada (403),
-- exceto para quem está na lista de emergência public.login_senha_emergencia.
-- O login pelo Google (ponte Conta MAX → magiclink/otp), "entrar como" e links de convite não usam senha
-- e continuam funcionando. Sessões antigas abertas com senha caem na próxima renovação (até ~1 h).
--
-- Ligar/desligar (sem SQL): Management API PATCH /v1/projects/<ref>/config/auth
--   ligar:    {"hook_custom_access_token_enabled": true,
--              "hook_custom_access_token_uri": "pg-functions://postgres/public/login_so_google_hook"}
--   desligar: {"hook_custom_access_token_enabled": false}
-- Acesso de emergência (não aparece em tela): insert into public.login_senha_emergencia(user_id, motivo) ...
--   e definir a senha da conta pelo painel do Supabase (Authentication → Users). Remover a linha desfaz.

create table if not exists public.login_senha_emergencia (
  user_id uuid primary key references auth.users(id) on delete cascade,
  motivo text not null,
  criado_em timestamptz not null default now()
);
alter table public.login_senha_emergencia enable row level security;
revoke all on table public.login_senha_emergencia from anon, authenticated, public;
grant select on table public.login_senha_emergencia to supabase_auth_admin;
drop policy if exists login_senha_emergencia_auth_admin on public.login_senha_emergencia;
create policy login_senha_emergencia_auth_admin on public.login_senha_emergencia
  for select to supabase_auth_admin using (true);

create or replace function public.login_so_google_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  amr jsonb := event->'claims'->'amr';
  usa_senha boolean;
begin
  usa_senha := coalesce(event->>'authentication_method', '') = 'password'
    or (jsonb_typeof(amr) = 'array' and exists (
          select 1 from jsonb_array_elements(amr) a
          where jsonb_typeof(a) = 'object' and a->>'method' = 'password'));
  if usa_senha and not exists (
       select 1 from public.login_senha_emergencia e where e.user_id = (event->>'user_id')::uuid) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Entrada por senha desativada. Use o botão Entrar com Google.'));
  end if;
  return jsonb_build_object('claims', event->'claims');
exception when others then
  -- Falha inesperada nunca tranca todo mundo: segue o comportamento padrão.
  return jsonb_build_object('claims', event->'claims');
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.login_so_google_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.login_so_google_hook(jsonb) from authenticated, anon, public;

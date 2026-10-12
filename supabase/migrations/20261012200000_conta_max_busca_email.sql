-- Conta MAX: busca direta de usuário por e-mail (cartão t_daa40545, aprovado por Denis em 12/10/2026).
-- Antes a ponte conta-max-bridge listava só a 1ª página de 1.000 usuários (auth.admin.listUsers) e
-- filtrava em memória: acima de 1.000 usuários, contas reais passariam a ser "account_email_not_found".
-- Esta função devolve os ids de auth.users com aquele e-mail (comparação sem maiúsculas/espaços), sem limite.
-- A ponte continua exigindo exatamente 1 resultado (0 → not_found, 2+ → ambiguous).
-- Só service_role executa (a ponte usa service_role). Não altera dados.
-- Rollback: supabase/rollback/20261012200000_conta_max_busca_email.sql
-- ORDEM DE PUBLICAÇÃO: aplicar esta migration ANTES de publicar a edge function conta-max-bridge nova.

create or replace function public.conta_max_auth_user_ids_by_email(_email text)
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(trim(coalesce(_email, ''))) <> ''
    and lower(trim(u.email)) = lower(trim(_email))
  limit 2;
$$;

revoke all on function public.conta_max_auth_user_ids_by_email(text) from public, anon, authenticated;
grant execute on function public.conta_max_auth_user_ids_by_email(text) to service_role;

comment on function public.conta_max_auth_user_ids_by_email(text) is
  'Conta MAX bridge: ids de auth.users com o e-mail informado (máx. 2, para detectar ambiguidade). Só service_role.';

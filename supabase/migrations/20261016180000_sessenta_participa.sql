-- "Participa do 60 Dias MAX" por usuário/imobiliária (cartão t_2ea96382, regra de Denis 16/10).
-- Regra do robô sync-satelites para o satélite "sessenta": vão donos (owner) e gestores (manager) ATIVOS
-- e corretores (agent) ATIVOS com participa_sessenta = true. Ninguém entra por data.
-- Aditiva: coluna nova com padrão false (nenhum corretor é marcado por esta migration) e a função de estado
-- passa a devolver a coluna. Estudo e Visita não mudam. Rollback: supabase/rollback/20261016180000_sessenta_participa.sql

alter table public.organization_members
  add column if not exists participa_sessenta boolean not null default false;

comment on column public.organization_members.participa_sessenta is
  'Participa do 60 Dias MAX. Ligado/desligado pelo dono ou gestor no cadastro do usuário. Corretor só vai ao 60 Dias com true; dono e gestor ativos vão sempre.';

-- O tipo de retorno muda (coluna nova no fim), então a função precisa ser recriada.
-- O robô atual ignora colunas que não conhece, então a troca não quebra a versão em produção.
drop function if exists public.sync_estado_desejado(uuid[], uuid);
create function public.sync_estado_desejado(p_user_ids uuid[] default null, p_org uuid default null)
returns table (adm_user_id uuid, org_id uuid, email text, nome text, telefone text, ativo boolean, roles text[],
               lider_email text, participa_sessenta boolean)
language sql stable security definer set search_path = '' as $$
  select p.id,
         coalesce(om.organization_id, p.organization_id),
         lower(trim(coalesce(nullif(trim(p.email), ''), u.email::text))),
         p.nome,
         p.telefone,
         (p.ativo and coalesce(om.ativo, false)),
         coalesce((select array_agg(ur.role::text order by ur.role::text) from public.user_roles ur where ur.user_id = p.id), '{}'),
         (select lower(trim(coalesce(nullif(trim(lp.email), ''), lu.email::text)))
            from public.team_members tm
            join public.teams t on t.id = tm.team_id
            join public.profiles lp on lp.id = t.lider_id
            left join auth.users lu on lu.id = lp.id
           where tm.membro_id = p.id and t.lider_id <> p.id
           limit 1),
         coalesce(om.participa_sessenta, false)
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.organization_members om on om.user_id = p.id
   where (p_user_ids is null or p.id = any (p_user_ids))
     and (p_org is null or coalesce(om.organization_id, p.organization_id) = p_org)
$$;
revoke all on function public.sync_estado_desejado(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.sync_estado_desejado(uuid[], uuid) to service_role;

-- Ligar/desligar a opção já enfileira a pessoa: o gatilho trg_zz_sync_org_members (20261011120000)
-- dispara em qualquer UPDATE de organization_members e só anota quando sync_config.mode <> 'off'.

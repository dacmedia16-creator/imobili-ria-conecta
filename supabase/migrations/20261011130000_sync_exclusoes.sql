-- Cadastro único, etapa 2 (cartão t_88c294cb): lista de exclusão persistente da sincronização.
-- Pessoa listada aqui NUNCA é enviada ao satélite indicado (nem em dry_run): o robô e a reconciliação
-- pulam a pessoa e só registram "excluido" com o motivo. Decisões de Denis em 11/10/2026.
create table if not exists public.sync_exclusoes (
  adm_user_id uuid not null,
  satelite text not null check (satelite in ('estudo', 'visita')),
  motivo text not null check (length(btrim(motivo)) > 0),
  decidido_por text not null default 'Denis',
  criado_em timestamptz not null default now(),
  primary key (adm_user_id, satelite)
);
alter table public.sync_exclusoes enable row level security;
revoke all on public.sync_exclusoes from public, anon, authenticated;
grant select, insert, update, delete on public.sync_exclusoes to service_role;

insert into public.sync_exclusoes (adm_user_id, satelite, motivo)
select v.adm_user_id::uuid, v.satelite, v.motivo
  from (values
    ('e9feec17-befc-45be-a4df-7f2aba9b15c1', 'estudo', 'Vitor Baptista: no Estudo o e-mail é de uma conta da plataforma. Não vincular nem alterar (Denis, 11/10/2026).'),
    ('8bd4ee6a-ca8f-4384-9cf3-eabc7784b5c3', 'estudo', 'Ricardo Augusto Lopes de Lara: no Estudo a conta é proprietária de outra imobiliária. Manter org, papel e status (Denis, 11/10/2026).'),
    ('396b03b2-04e5-4a59-b221-1bf153fe0afa', 'estudo', 'Jussara Aparecida de Siqueira: no Estudo a conta está em outra imobiliária. Manter como está (Denis, 11/10/2026).'),
    ('1596e4d0-5454-41a1-b734-928dce72f121', 'estudo', 'Gabriel Altomare: mesma pessoa de outra conta (telefone). Ficar como está, sem juntar nem alterar (Denis, 11/10/2026).'),
    ('1596e4d0-5454-41a1-b734-928dce72f121', 'visita', 'Gabriel Altomare: mesma pessoa de outra conta (telefone). Ficar como está, sem juntar nem alterar (Denis, 11/10/2026).'),
    ('4917692c-3ec6-4501-9c0d-3aaf3b2a68c9', 'estudo', 'Conta "gestor" @teste.com.br do ADM: conta de teste, não criar em satélite (Denis, 11/10/2026).'),
    ('4917692c-3ec6-4501-9c0d-3aaf3b2a68c9', 'visita', 'Conta "gestor" @teste.com.br do ADM: conta de teste, não criar em satélite (Denis, 11/10/2026).')
  ) as v(adm_user_id, satelite, motivo)
 where exists (select 1 from public.profiles p where p.id = v.adm_user_id::uuid)
on conflict (adm_user_id, satelite) do nothing;

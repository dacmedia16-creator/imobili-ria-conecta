-- t_06782054 — PASSO PÓS-PUBLICAÇÃO. NÃO rodar antes de: (a) a função sync-satelites nova estar no ar;
-- (b) ok de Denis. Banco: ADM MAX (produção), SQL Editor (service role). Nenhuma consulta mostra e-mail ou nome de pessoa.
-- Ajuste da revisão: reenfileira SÓ os Administradores principais (sync_enfileirar por pessoa), não a imobiliária
-- inteira (sync_enfileirar_org mexeria em todas as pessoas das 5 imobiliárias). Imobiliárias por ID, não por nome.

-- 0) Achar os IDs (só leitura). Busca aproximada por nome; conferir que vieram as 5 certas e copiar os ids.
select o.id, o.nome, m.mode, m.estudo_enabled, m.visita_enabled
  from public.organizations o
  left join public.sync_org_map m on m.adm_org_id = o.id
 where o.nome ilike any (array['%capacit%', '%meet%', '%confer%ncia%', '%eleita%', '%nica escolha%'])
 order by o.nome;
-- Esperado: 5 linhas, mode=live, estudo_enabled=true, visita_enabled=true.

-- 1) Prévia (só leitura): quem será reenfileirado. Colar os 5 ids em ORGS (aqui) e em v_orgs (passo 2).
--    Uma linha por pessoa (id interno, sem dado pessoal). Se aparecer alguém que não é dono de imobiliária
--    (conta de suporte/MAX com super_admin fora de platform_admins), PARAR e decidir antes (risco da revisão).
with orgs(id) as (values ('00000000-0000-0000-0000-000000000000'::uuid) /* , ('<id2>'::uuid), ... os 5 ids */)
select o.nome, ur.user_id as adm_user_id, p.ativo,
       exists (select 1 from public.platform_admins pa where pa.user_id = ur.user_id) as eh_plataforma
  from public.user_roles ur
  join orgs on orgs.id = ur.organization_id
  join public.organizations o on o.id = ur.organization_id
  join public.profiles p on p.id = ur.user_id
 where ur.role::text = 'super_admin'
 order by o.nome;
-- Esperado (produção, revisão t_c024f5da): 6 donos no total — 2 na Única Escolha e 1 em cada uma das outras
-- 4 imobiliárias — todos com eh_plataforma=false. Se vier diferente, PARAR (o passo 2 também para sozinho).
-- Conferir também: select count(*) from public.platform_admins;  -> precisa ser >= 1 (senão o robô para de propósito).

-- 2) Reenfileirar (ESCRITA: só insere na sync_outbox; o cron processa em ~1 min). Idempotente.
--    Bloco único: primeiro confere e dá ERRO (nada é gravado) se: não forem exatamente 5 imobiliárias; o total de
--    donos não for 6 (2 na Única Escolha + 1 em cada outra, ou seja, 6 donos em 5 imobiliárias); algum dono estiver
--    em platform_admins; platform_admins estiver vazia; ou o sync estiver desligado. Só depois chama sync_enfileirar.
do $$
declare
  v_orgs   uuid[] := array['00000000-0000-0000-0000-000000000000'::uuid /* , '<id2>'::uuid, ... os 5 ids */];
  v_n_orgs int;
  v_donos  int;
  v_orgs_com_dono int;
  v_max_por_org int;
  v_plataforma int;
  v_mode text;
  v_enfileirados int := 0;
  r record;
begin
  select count(*) into v_n_orgs from public.organizations o where o.id = any (v_orgs);
  if v_n_orgs <> 5 then
    raise exception 'PARADO: esperava 5 imobiliárias válidas em v_orgs, vieram %.', v_n_orgs;
  end if;

  select count(distinct ur.user_id), count(distinct ur.organization_id)
    into v_donos, v_orgs_com_dono
    from public.user_roles ur
   where ur.organization_id = any (v_orgs) and ur.role::text = 'super_admin';
  select coalesce(max(n), 0) into v_max_por_org
    from (select count(distinct ur.user_id) n from public.user_roles ur
           where ur.organization_id = any (v_orgs) and ur.role::text = 'super_admin'
           group by ur.organization_id) t;
  -- 6 donos em 5 imobiliárias com no máximo 2 por imobiliária = exatamente uma com 2; ela tem de ser a Única Escolha.
  if v_donos <> 6 or v_orgs_com_dono <> 5 or v_max_por_org <> 2
     or not exists (select 1 from public.user_roles ur join public.organizations o on o.id = ur.organization_id
                     where ur.organization_id = any (v_orgs) and ur.role::text = 'super_admin'
                       and o.nome ilike '%nica escolha%'
                     group by ur.organization_id having count(distinct ur.user_id) = 2) then
    raise exception 'PARADO: esperava 6 donos (2 na Única Escolha + 1 em cada outra). Vieram % donos em % imobiliárias (máx. % por imobiliária).',
      v_donos, v_orgs_com_dono, v_max_por_org;
  end if;

  select count(*) into v_plataforma
    from public.user_roles ur
   where ur.organization_id = any (v_orgs) and ur.role::text = 'super_admin'
     and exists (select 1 from public.platform_admins pa where pa.user_id = ur.user_id);
  if v_plataforma > 0 then
    raise exception 'PARADO: % dono(s) está(ão) em platform_admins. Decidir antes de reenfileirar.', v_plataforma;
  end if;

  if not exists (select 1 from public.platform_admins) then
    raise exception 'PARADO: platform_admins vazia (o robô recusaria a fila).';
  end if;

  select coalesce((select c.mode from public.sync_config c where c.id), 'off') into v_mode;
  if v_mode = 'off' then
    raise exception 'PARADO: sync_config.mode = % (sync_enfileirar não faria nada).', coalesce(v_mode, 'null');
  end if;

  for r in
    select distinct ur.user_id
      from public.user_roles ur
     where ur.organization_id = any (v_orgs) and ur.role::text = 'super_admin'
       and not exists (select 1 from public.platform_admins pa where pa.user_id = ur.user_id)
  loop
    perform public.sync_enfileirar(r.user_id, 'admin_principal_t_06782054');
    v_enfileirados := v_enfileirados + 1;
  end loop;
  raise notice 'OK: % donos reenfileirados.', v_enfileirados;
end $$;

-- 3) Conferência (só leitura), ~2 min depois. Esperado por pessoa: estudo e visita com acao criar (ou
--    vincular_existente) e resultado ok. 'conflito' = ver passo 4.
select l.adm_user_id, l.satelite, l.acao, l.resultado, left(coalesce(l.erro, ''), 80) as erro, l.criado_em
  from public.sync_log l
 where l.adm_user_id in (select adm_user_id from public.sync_outbox where motivo = 'admin_principal_t_06782054')
   and l.criado_em > now() - interval '1 hour'
 order by l.adm_user_id, l.satelite, l.criado_em desc;

-- 4) Pendências (só leitura): itens que não fecharam ok e conflitos abertos dessas pessoas.
select x.adm_user_id, x.status, x.tentativas, left(coalesce(x.ultimo_erro, ''), 80) as erro
  from public.sync_outbox x
 where x.motivo = 'admin_principal_t_06782054' and x.status <> 'ok';
select c.adm_user_id, c.satelite, c.tipo, c.status, c.criado_em
  from public.sync_conflicts c
 where c.status = 'aberto'
   and c.adm_user_id in (select adm_user_id from public.sync_outbox where motivo = 'admin_principal_t_06782054');

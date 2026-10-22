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

-- 1) Prévia (só leitura): quem será reenfileirado. Colar os 5 ids em ORGS (aqui e nos passos 2-4).
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
-- Esperado (diagnóstico t_0557adda): 5 pessoas, 1 por imobiliária, eh_plataforma=false. Se vier diferente, PARAR.
-- Conferir também: select count(*) from public.platform_admins;  -> precisa ser >= 1 (senão o robô para de propósito).

-- 2) Reenfileirar (ESCRITA: só insere na sync_outbox; o cron processa em ~1 min). Idempotente.
with orgs(id) as (values ('00000000-0000-0000-0000-000000000000'::uuid) /* , os 5 ids */),
alvo as (
  select distinct ur.user_id
    from public.user_roles ur join orgs on orgs.id = ur.organization_id
   where ur.role::text = 'super_admin'
     and not exists (select 1 from public.platform_admins pa where pa.user_id = ur.user_id)
)
select count(*) as enfileirados from (select public.sync_enfileirar(a.user_id, 'admin_principal_t_06782054') from alvo a) x;
-- Obs.: sync_enfileirar não faz nada se sync_config.mode = 'off'. Conferir com: select mode from public.sync_config;

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

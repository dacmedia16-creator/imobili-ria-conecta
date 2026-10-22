-- t_06782054 — PASSO PÓS-PUBLICAÇÃO (NÃO rodar antes de a função sync-satelites nova estar no ar e de Denis dar o ok).
-- Banco: ADM MAX (produção). Rodar no SQL Editor (service role). Não mostra e-mail nem nome de pessoa.

-- 0) Prévia (só leitura): as 5 imobiliárias, se o mapa está ligado e quantos "Administrador principal"
--    (super_admin fora de platform_admins) cada uma tem. Esperado: 5 linhas, mode=live, ambos ligados, admins_principais>=1.
select o.id, o.nome, m.mode, m.estudo_enabled, m.visita_enabled,
       (select count(*) from public.user_roles ur
         where ur.role::text = 'super_admin' and ur.organization_id = o.id
           and not exists (select 1 from public.platform_admins pa where pa.user_id = ur.user_id)) as admins_principais
  from public.organizations o
  left join public.sync_org_map m on m.adm_org_id = o.id
 where o.nome in ('REMAX CAPACITÁ', 'REMAX MEET', 'REMAX - Conferência MAX', 'RE/MAX Eleita', 'RE/MAX Única Escolha')
 order by o.nome;
-- Se vier menos de 5 linhas, conferir a grafia do nome (ex.: "REMAX" x "RE/MAX") antes de seguir.

-- 1) Reenfileirar (escrita: só insere itens na sync_outbox; o cron processa em seguida).
--    Idempotente: quem já está pendente não é duplicado.
select o.nome, public.sync_enfileirar_org(o.id, 'admin_principal_t_06782054') as enfileirados
  from public.organizations o
  join public.sync_org_map m on m.adm_org_id = o.id
 where o.nome in ('REMAX CAPACITÁ', 'REMAX MEET', 'REMAX - Conferência MAX', 'RE/MAX Eleita', 'RE/MAX Única Escolha');

-- 2) Conferência (só leitura), ~2 min depois: resultado no Estudo/Visita de cada Administrador principal.
--    Esperado por pessoa: estudo = criar ok (ou vincular_existente ok) e visita = criar ok (ou vincular_existente ok).
select o.nome, l.satelite, l.acao, l.resultado, left(coalesce(l.erro, ''), 80) as erro, l.criado_em
  from public.sync_log l
  join public.user_roles ur on ur.user_id = l.adm_user_id and ur.role::text = 'super_admin'
  join public.organizations o on o.id = ur.organization_id
 where o.nome in ('REMAX CAPACITÁ', 'REMAX MEET', 'REMAX - Conferência MAX', 'RE/MAX Eleita', 'RE/MAX Única Escolha')
   and l.criado_em > now() - interval '1 hour'
 order by o.nome, l.satelite, l.criado_em desc;

-- 3) Pendências (só leitura): fila e conflitos abertos dessas pessoas (ex.: rebaixar_owner, possivel_duplicata).
select o.nome, x.status, x.tentativas, left(coalesce(x.ultimo_erro, ''), 80) as erro
  from public.sync_outbox x
  join public.user_roles ur on ur.user_id = x.adm_user_id and ur.role::text = 'super_admin'
  join public.organizations o on o.id = ur.organization_id
 where x.motivo = 'admin_principal_t_06782054' and x.status <> 'ok';
select c.satelite, c.tipo, c.status, c.criado_em
  from public.sync_conflicts c
  join public.user_roles ur on ur.user_id = c.adm_user_id and ur.role::text = 'super_admin'
 where c.status = 'aberto';

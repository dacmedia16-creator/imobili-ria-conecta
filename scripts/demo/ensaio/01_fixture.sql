-- Ensaio LOCAL: fixture mínima e 100% fictícia (nenhum dado de produção).
-- ZZ com leads ligado + 23 leads abertos "da Nicole" + 2 corretores reais simulados; outra org (simula a Única) com 1 usuário.
begin;
insert into public.organizations (id, slug, nome, status) values
 ('eb0a260a-db2f-4cbf-b031-f0c2aebb407c', 'zz-teste-provisionamento', 'ZZ Teste Provisionamento', 'ativa'),
 ('0e0e0e0e-0000-4000-8000-000000000001', 'outra-org', 'Outra Org (simula a Única)', 'ativa');
insert into public.sync_org_map (adm_org_id, mode) values ('eb0a260a-db2f-4cbf-b031-f0c2aebb407c', 'off');
insert into public.organization_modules (organization_id, module, enabled) values
 ('eb0a260a-db2f-4cbf-b031-f0c2aebb407c', 'leads', true), ('eb0a260a-db2f-4cbf-b031-f0c2aebb407c', 'crm', true);
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-000000000000', '11111111-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'real1@fixture.local', '', now(),
  '{"organization_id":"eb0a260a-db2f-4cbf-b031-f0c2aebb407c"}', '{"nome":"Corretor Existente 1"}', now(), now()),
 ('00000000-0000-0000-0000-000000000000', '11111111-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'real2@fixture.local', '', now(),
  '{"organization_id":"eb0a260a-db2f-4cbf-b031-f0c2aebb407c"}', '{"nome":"Corretor Existente 2"}', now(), now()),
 ('00000000-0000-0000-0000-000000000000', '22222222-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'outra@fixture.local', '', now(),
  '{"organization_id":"0e0e0e0e-0000-4000-8000-000000000001"}', '{"nome":"Usuario Outra Org"}', now(), now());
insert into public.lead_config (organization_id, distribuicao) values ('eb0a260a-db2f-4cbf-b031-f0c2aebb407c', 'captador_depois_rodizio');
insert into public.leads (organization_id, nome, telefone, origem, etapa, responsavel_id, atribuido_em, aceito_em, tentativas_aceite, simulado)
select 'eb0a260a-db2f-4cbf-b031-f0c2aebb407c', 'Lead Fixture ' || g, '+551590000' || lpad(g::text,4,'0'), 'simulador', 'novo',
       case when g % 2 = 0 then '11111111-0000-4000-8000-000000000001'::uuid else '11111111-0000-4000-8000-000000000002'::uuid end,
       now() - interval '2 hours', case when g % 3 = 0 then now() - interval '1 hour' end, 1, true
from generate_series(1, 23) g;
commit;

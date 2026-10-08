-- Suíte "código do anúncio sem hífen" (migration 20261008230000). Roda DENTRO de transação revertida
-- (run-portal-remax-id-sem-hifen.sh), DEPOIS do setup portal_remax_id_sem_hifen_setup.sql (semana 1
-- gravada com a regra antiga) e da migration. Homologação: A = Única, B = agencia-b-homolog (papel da
-- REMAX-TESTE). Perfis: corretor (UE Corretor), colega (QA A Corretor Tres), gestor da equipe (UE Gestor),
-- gestor de OUTRA equipe (QA A Gestor), admin (QA A Admin) e admin B. IDs RE/MAX e códigos fictícios.
CREATE FUNCTION pg_temp.n(_where text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE c bigint; BEGIN
  EXECUTE 'SELECT count(*) FROM public.portal_listing_snapshots WHERE collected_on IN (''2026-01-05'',''2026-01-12'') AND ' || _where INTO c;
  RETURN c; END $$;

-- ===== Regra nova na coluna gerada e no acerto da semana já gravada ===========================
SELECT pg_temp.ok((SELECT remax_id FROM public.portal_listing_snapshots WHERE listing_code = '630601901x16' AND collected_on = '2026-01-05') = '630601901',
  'semana já gravada: 630601901x16 passa a ter remax_id 630601901');
SELECT pg_temp.ok(pg_temp.n($$collected_on = '2026-01-05' AND broker_id = '10000000-0000-4000-8000-000000000003'$$) = 5,
  'semana já gravada: 5 anúncios (hífen, x, xx, XX e o que deu erro na coleta) ligados ao corretor');
SELECT pg_temp.ok(pg_temp.n($$collected_on = '2026-01-05' AND broker_id = 'a742cfda-4731-4fa8-989a-374d2fdf0820'$$) = 2,
  'semana já gravada: 630601902x3 (e o -8) ligados ao colega');
SELECT pg_temp.ok(pg_temp.n($$collected_on = '2026-01-05' AND listing_code IN ('63060190x72','630601901','630601901y4','6306019011x2') AND remax_id IS NULL AND broker_id IS NULL$$) = 4,
  'NÃO ligam: 8 dígitos, sem final, separador y, 10 dígitos');
SELECT pg_temp.ok(pg_temp.n($$collected_on = '2026-01-05' AND listing_code IN ('630591555x9','631831777-2') AND broker_id IS NULL AND remax_id IS NOT NULL$$) = 2,
  'outros escritórios (630591/631831) sem perfil continuam Sem corretor, com remax_id reconhecido');

-- ===== Gravação semanal nova (portal_ingest) usa a mesma regra ================================
SELECT pg_temp.ok((public.portal_ingest(:'org_a'::uuid, 'imovelweb', '2026-01-12', 'last30',
  '[{"code":"630601901x16","views":10,"contacts":1,"impressions":100},
    {"code":"630601901xx7","views":5,"contacts":0,"impressions":50},
    {"code":"630601902x3","views":2,"contacts":0,"impressions":20},
    {"code":"63060190x72","views":1,"contacts":0,"impressions":10},
    {"code":"630591555x9","views":1,"contacts":0,"impressions":10}]'::jsonb, 5, now()) ->> 'linked')::int = 3,
  'ingest novo: liga 3 de 5 (2 do corretor, 1 do colega)');

-- ===== Visibilidade por perfil NÃO muda ======================================================
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('corretor')::text);
SELECT pg_temp.ok(pg_temp.n('true') = pg_temp.n($$broker_id = '10000000-0000-4000-8000-000000000003'$$) AND pg_temp.n('true') = 7,
  'corretor vê só os dele (7 linhas, nenhum do colega nem Sem corretor)');
SELECT pg_temp.as_user(pg_temp.id('colega')::text);
SELECT pg_temp.ok(pg_temp.n('true') = 3 AND pg_temp.n($$broker_id <> 'a742cfda-4731-4fa8-989a-374d2fdf0820'$$) = 0,
  'colega vê só os dele (3 linhas)');
SELECT pg_temp.as_user(pg_temp.id('gestor')::text);
SELECT pg_temp.ok(pg_temp.n($$broker_id = '10000000-0000-4000-8000-000000000003'$$) = 7 AND pg_temp.n('broker_id IS NULL') = 0,
  'gestor da equipe vê os 7 do corretor da equipe e nenhum Sem corretor');
SELECT pg_temp.ok(pg_temp.n('true') = 7 + CASE WHEN public.is_lead_of(pg_temp.id('gestor'), pg_temp.id('colega')) THEN 3 ELSE 0 END,
  'gestor da equipe: total = só a equipe dele');
SELECT pg_temp.as_user(pg_temp.id('outra')::text);
SELECT pg_temp.ok(pg_temp.n($$broker_id = '10000000-0000-4000-8000-000000000003'$$) = 0 AND pg_temp.n('broker_id IS NULL') = 0,
  'gestor de OUTRA equipe não vê os anúncios do corretor');
SELECT pg_temp.as_user(pg_temp.id('admin')::text);
SELECT pg_temp.ok(pg_temp.n('true') = 18, 'admin da Única vê todos (18 linhas, inclusive Sem corretor)');
SELECT pg_temp.as_user(pg_temp.id('b_admin')::text);
SELECT pg_temp.ok(pg_temp.n('true') = 0, 'REMAX-TESTE (admin B) vê 0 anúncios da Única');
RESET ROLE;

-- ===== Trocar o ID do perfil continua religando (trigger existente) ===========================
UPDATE public.profiles SET remax_id = NULL WHERE id = pg_temp.id('colega');
SELECT pg_temp.ok(pg_temp.n($$listing_code = '630601902x3' AND broker_id IS NULL$$) = 2,
  'apagar o ID do colega desliga os anúncios dele sem hífen');
UPDATE public.profiles SET remax_id = '630601902' WHERE id = pg_temp.id('colega');
SELECT pg_temp.ok(pg_temp.n($$listing_code = '630601902x3' AND broker_id = 'a742cfda-4731-4fa8-989a-374d2fdf0820'$$) = 2,
  'salvar o ID de novo religa os anúncios sem hífen');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE NOT ok) || ' falhas de ' || count(*) FROM r;

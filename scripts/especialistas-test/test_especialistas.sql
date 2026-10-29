-- Testes da migration 20261029150000_especialistas_por_imobiliaria (card t_6d8de1d7) num clone LOCAL.
-- Pré-requisito: seed_pre.sql + migration aplicados. Tudo em transação desfeita no fim (ROLLBACK).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
BEGIN;
CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
CREATE TABLE t.res (n serial, ok boolean, label text);
GRANT ALL ON t.res TO anon, authenticated; GRANT ALL ON SEQUENCE t.res_n_seq TO anon, authenticated;
CREATE FUNCTION t.ok(_c boolean, _l text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO t.res (ok, label) VALUES (coalesce(_c, false), _l); END $$;
CREATE FUNCTION t.como(_u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
CREATE FUNCTION t.anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true); PERFORM set_config('role', 'anon', true); END $$;
CREATE FUNCTION t.dono() RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('role', 'none', true); PERFORM set_config('request.jwt.claims', '', true); END $$;
CREATE FUNCTION t.falha(_sql text, _trecho text DEFAULT '') RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN position(lower(_trecho) IN lower(SQLERRM)) > 0; END $$;
-- status do vínculo região × imobiliária (lido como dono)
CREATE FUNCTION t.st(_r bigint, _slug text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT l.status FROM public.positioning_region_orgs l JOIN public.organizations o ON o.id = l.organization_id
                    WHERE l.region_id = _r AND o.slug = _slug), 'sem')
$$;
CREATE FUNCTION t.rid(_nome text) RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  SELECT id FROM public.positioning_regions WHERE public.regiao_norm(nome) = public.regiao_norm(_nome)
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO anon, authenticated;

\set UE '''00000000-0000-4000-8000-000000000001'''
\set ZZ '''e5000000-0000-0000-0000-00000000000b'''
\set CAP '''e5000000-0000-0000-0000-00000000000f'''
\set VOL '''e5000000-0000-0000-0000-00000000000e'''
\set aUE '''e5000000-0000-0000-0000-0000000a0a01'''
\set c1UE '''e5000000-0000-0000-0000-0000000a0c01'''
\set c2UE '''e5000000-0000-0000-0000-0000000a0c02'''
\set aCAP '''e5000000-0000-0000-0000-0000000f0a01'''
\set cCAP '''e5000000-0000-0000-0000-0000000f0c01'''
\set cVOL '''e5000000-0000-0000-0000-0000000e0c01'''
\set aZZ '''e5000000-0000-0000-0000-0000000b0a01'''
\set cZZ '''e5000000-0000-0000-0000-0000000b0c01'''
\set aVOL '''e5000000-0000-0000-0000-0000000e0a01'''
\set plat '''e5000000-0000-0000-0000-0000000ff001'''

-- Pessoas extras (fictícias): admin + corretor na ZZ, admin na Volute, admin da plataforma (sem papel na UE).
SET session_replication_role = replica;
INSERT INTO auth.users (id, email) SELECT u, 'x' || right(u::text, 6) || '@exemplo.invalid'
  FROM unnest(ARRAY[:aZZ, :cZZ, :aVOL, :plat]::uuid[]) u;
INSERT INTO public.profiles (id, nome, ativo, organization_id) VALUES
  (:aZZ, 'Admin ZZ', true, :ZZ), (:cZZ, 'Corretor ZZ', true, :ZZ), (:aVOL, 'Admin Volute', true, :VOL),
  (:plat, 'Plataforma', true, :UE);
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:ZZ, :aZZ, true), (:ZZ, :cZZ, true), (:VOL, :aVOL, true), (:UE, :plat, true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:aZZ, 'admin', :ZZ), (:cZZ, 'corretor', :ZZ), (:aVOL, 'admin', :VOL);
INSERT INTO public.platform_admins (user_id) VALUES (:plat);
SET session_replication_role = origin;

-- 0) Migração dos dados atuais ---------------------------------------------------------------------------
SELECT t.ok(t.st(9001, 'unica-escolha') = 'ativa' AND t.st(9002, 'unica-escolha') = 'ativa' AND t.st(9003, 'unica-escolha') = 'ativa',
  'M01 regiões atuais continuam ativas para a UE');
SELECT t.ok(t.st(9001, 'zz-teste') = 'ativa' AND t.st(9003, 'zz-teste') = 'sem',
  'M02 região de Sorocaba ativa para a outra imobiliária de Sorocaba; Votorantim não (cidade diferente)');
SELECT t.ok(t.st(9004, 'remax-capacita') = 'ativa' AND t.st(9004, 'unica-escolha') = 'sem', 'M03 região de Nova Friburgo só para a Capacitá');
SELECT t.ok((SELECT count(*) FROM public.corretor_positioning_regions WHERE corretor_id = :c1UE) = 2, 'M04 escolhas do corretor preservadas');
SELECT t.ok((SELECT count(*) FROM public.positioning_region_suggestions WHERE status = 'pendente') = 1, 'M05 sugestão pendente preservada');
SELECT t.ok((SELECT string_agg(o.slug, ',' ORDER BY o.slug) FROM public.organization_modules m JOIN public.organizations o ON o.id = m.organization_id
              WHERE m.module = 'especialistas_publico' AND m.enabled) = 'unica-escolha', 'M06 página pública ligada só na UE');
SELECT t.ok((SELECT uf FROM public.positioning_regions WHERE id = 9004) = 'RJ', 'M07 UF da região = UF da imobiliária que criou');

-- Volute ganha cidade Sorocaba: herda o catálogo atual da cidade como ativo.
UPDATE public.organizations SET cidade = 'sorocaba ', uf = 'SP' WHERE id = :VOL;
SELECT t.ok(t.st(9001, 'remax-volute') = 'ativa' AND t.st(9002, 'remax-volute') = 'ativa' AND t.st(9003, 'remax-volute') = 'sem',
  'M08 imobiliária que passa a ter cidade herda o catálogo existente (sem acento/maiúscula)');

-- 1) Página pública -------------------------------------------------------------------------------------
SELECT t.anon();
SELECT t.ok((SELECT string_agg(slug || ':' || especialistas, ',') FROM public.list_public_specialist_agencies()) = 'unica-escolha:2',
  'P01 lista pública: só a UE (ligada), com nº de especialistas');
SELECT t.ok((SELECT count(*) FROM public.list_public_org_specialists('zz-teste')) = 0, 'P02 imobiliária desligada: nenhum especialista');
SELECT t.ok((SELECT count(*) FROM public.list_public_org_regions('zz-teste')) = 0, 'P03 imobiliária desligada: nenhuma região');
SELECT t.ok((SELECT count(*) FROM public.list_public_org_specialists('nao-existe')) = 0, 'P04 slug inexistente: vazio');
SELECT t.ok((SELECT string_agg(id::text, ',' ORDER BY id) FROM public.list_public_org_regions('unica-escolha')) = '9001,9003',
  'P05 filtro mostra só regiões em que a imobiliária tem corretor');
SELECT t.ok((SELECT count(*) FROM public.list_public_org_specialists('unica-escolha', NULL, 9001)) = 1, 'P06 filtro por região');
SELECT t.ok((SELECT count(*) FROM public.list_public_org_specialists('unica-escolha', 'campol', NULL)) = 1, 'P07 busca por bairro');
SELECT t.ok((SELECT count(*) FROM public.list_public_specialists()) = 2 AND (SELECT count(*) FROM public.list_public_positioning_regions()) = 2,
  'P08 RPCs antigas continuam funcionando (imobiliária histórica)');
SELECT t.ok(t.falha('SELECT * FROM public.positioning_region_orgs'), 'P09 anon não lê a tabela de vínculos');
SELECT t.ok(t.falha($$SELECT public.positioning_region_create('Sorocaba','SP',null,'X Y','bairro')$$), 'P10 anon não cria região');
SELECT t.dono();

-- ZZ ligada pela plataforma, mas sem especialista: não aparece. Com 1 especialista: aparece, isolada.
SELECT t.como(:plat);
SELECT public.platform_set_organization_module(:ZZ, 'especialistas_publico', true);
SELECT t.dono();
UPDATE public.user_roles SET role = 'gestor' WHERE user_id = :cZZ;
SELECT t.anon();
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.list_public_specialist_agencies() WHERE slug = 'zz-teste'), 'P11 ligada sem especialista não aparece');
SELECT t.dono();
UPDATE public.user_roles SET role = 'corretor' WHERE user_id = :cZZ;
SELECT t.como(:aZZ);
SELECT t.ok(t.falha($$SELECT public.platform_set_organization_module('e5000000-0000-0000-0000-00000000000b', 'especialistas_publico', false)$$, 'super-admin'),
  'P12 admin da imobiliária não liga/desliga a página pública');
SELECT t.anon();
SELECT t.ok(EXISTS (SELECT 1 FROM public.list_public_specialist_agencies() WHERE slug = 'zz-teste' AND especialistas = 1), 'P13 ligada com especialista aparece');
SELECT t.ok((SELECT string_agg(nome, ',') FROM public.list_public_org_specialists('zz-teste')) = 'Corretor ZZ'
        AND NOT EXISTS (SELECT 1 FROM public.list_public_org_specialists('unica-escolha') WHERE nome = 'Corretor ZZ'),
  'P14 corretor de uma imobiliária não aparece na outra');
SELECT t.dono();

-- 2) Corretor escolhe só regiões ativas da própria imobiliária ----------------------------------------------
SELECT t.como(:cZZ);
SELECT t.ok((SELECT string_agg(id::text, ',' ORDER BY id) FROM public.my_positioning_regions()) = '9001,9002', 'R01 ZZ vê o catálogo de Sorocaba');
SELECT public.save_my_positioning(ARRAY[9001]::bigint[], true);
SELECT t.ok(t.falha('SELECT public.save_my_positioning(ARRAY[9003]::bigint[], true)', 'nao esta disponivel'), 'R02 não escolhe região de outra cidade');
SELECT t.ok(t.falha($$INSERT INTO public.corretor_positioning_regions (corretor_id, region_id) VALUES ('e5000000-0000-0000-0000-0000000b0c01', 9004)$$),
  'R03 nem por inserção direta');
SELECT t.como(:cCAP);
SELECT t.ok((SELECT string_agg(id::text, ',') FROM public.my_positioning_regions()) = '9004', 'R04 Capacitá não vê regiões de Sorocaba');
SELECT t.anon();
SELECT t.ok((SELECT string_agg(nome, ',') FROM public.list_public_org_specialists('zz-teste', NULL, 9001)) = 'Corretor ZZ'
        AND (SELECT count(*) FROM public.list_public_org_specialists('unica-escolha', NULL, 9001)) = 1,
  'R05 região compartilhada: cada página só lista os próprios corretores');
SELECT t.dono();

-- 3) Região nova em cidade compartilhada: aprovação POR imobiliária ------------------------------------------
SELECT t.como(:cZZ);
SELECT t.ok(t.falha($$SELECT public.positioning_region_create('Sorocaba','SP',null,'Jardim Novo','bairro')$$, 'administradores'), 'A01 corretor não cria região direto');
SELECT t.como(:aZZ);
SELECT t.ok(t.falha($$INSERT INTO public.positioning_regions (cidade, uf, nome, tipo) VALUES ('Sorocaba','SP','Direto','bairro')$$), 'A02 sem escrita direta na tabela');
SELECT t.ok((public.positioning_region_create('Sorocaba', 'SP', 'Sul', 'Jardim Novo', 'bairro')) ->> 'pendentes' = '2', 'A03 ZZ cria: pedido para as 2 outras');
SELECT t.dono();
SELECT t.ok(t.st(t.rid('Jardim Novo'), 'zz-teste') = 'ativa', 'A04 vale na hora para quem criou');
SELECT t.ok(t.st(t.rid('Jardim Novo'), 'unica-escolha') = 'pendente' AND t.st(t.rid('Jardim Novo'), 'remax-volute') = 'pendente', 'A05 pendente para UE e Volute');
SELECT t.ok(t.st(t.rid('Jardim Novo'), 'remax-capacita') = 'sem', 'A06 outra cidade não recebe o pedido');
SELECT t.como(:aCAP);
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.positioning_org_regions() WHERE nome = 'Jardim Novo'), 'A07 admin de outra cidade não vê o pedido');
SELECT t.ok(t.falha(format('SELECT public.positioning_region_decidir(%s, %L)', t.rid('Jardim Novo'), 'aprovar'), 'nao encontrada'), 'A08 nem consegue decidir');
SELECT t.como(:c1UE);
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.my_positioning_regions() WHERE nome = 'Jardim Novo'), 'A09 pendente não aparece para o corretor da UE');
SELECT t.ok(t.falha(format('SELECT public.save_my_positioning(ARRAY[%s]::bigint[], true)', t.rid('Jardim Novo')), 'nao esta disponivel'), 'A10 nem pode escolher');
SELECT t.como(:aUE);
SELECT t.ok((SELECT status FROM public.positioning_org_regions() WHERE nome = 'Jardim Novo') = 'pendente'
        AND (SELECT origem_nome FROM public.positioning_org_regions() WHERE nome = 'Jardim Novo') = 'ZZ Teste',
  'A11 admin da UE vê o pedido, com a imobiliária que pediu');
SELECT t.ok(public.positioning_region_decidir(t.rid('Jardim Novo'), 'aprovar') = 'ativa', 'A12 UE aprova para si');
SELECT t.dono();
SELECT t.ok(t.st(t.rid('Jardim Novo'), 'remax-volute') = 'pendente', 'A13 aprovação da UE não ativa para a Volute');
SELECT t.como(:c1UE);
SELECT public.save_my_positioning(ARRAY[9001, t.rid('Jardim Novo')]::bigint[], true);
SELECT t.ok((SELECT count(*) FROM public.corretor_positioning_regions WHERE corretor_id = :c1UE) = 2, 'A14 corretor da UE escolhe depois da aprovação');
SELECT t.como(:aVOL);
SELECT t.ok(t.falha(format('SELECT public.positioning_region_decidir(%s, %L)', t.rid('Jardim Novo'), 'recusar'), 'motivo'), 'A15 recusa exige motivo');
SELECT t.ok(public.positioning_region_decidir(t.rid('Jardim Novo'), 'recusar', 'Não atuamos lá') = 'recusada', 'A16 Volute recusa para si');
SELECT t.dono();
SELECT t.ok(t.st(t.rid('Jardim Novo'), 'unica-escolha') = 'ativa' AND t.st(t.rid('Jardim Novo'), 'zz-teste') = 'ativa', 'A17 recusa da Volute não afeta UE nem ZZ');
SELECT t.como(:aZZ);
SELECT t.ok(t.falha(format('SELECT public.positioning_region_decidir(%s, %L)', t.rid('Jardim Novo'), 'aprovar'))
        OR t.st(t.rid('Jardim Novo'), 'remax-volute') = 'recusada', 'A18 ZZ não decide pela Volute');
SELECT t.dono();
SELECT t.ok(t.st(t.rid('Jardim Novo'), 'remax-volute') = 'recusada', 'A19 decisão da Volute intacta');
-- Duplicata: mesmo nome sem acento/maiúscula/espaço não cria nem vira pedido.
SELECT t.como(:aUE);
SELECT t.ok((public.positioning_region_create('SOROCABA', 'SP', NULL, '  jardim   NÔVO ', 'bairro')) ->> 'resultado' = 'ja_ativa', 'A20 duplicata reconhecida');
SELECT t.como(:aVOL);
SELECT t.ok((public.positioning_region_create('Sorocaba', 'SP', NULL, 'Jardim Novo', 'bairro')) ->> 'resultado' = 'vinculada', 'A21 região existente só vincula, sem fila');
SELECT t.dono();
SELECT t.ok((SELECT count(*) FROM public.positioning_regions WHERE public.regiao_norm(nome) = 'jardim novo') = 1, 'A22 nenhuma região duplicada');
-- Plataforma vê tudo, mas não decide no lugar de uma imobiliária.
SELECT t.como(:aZZ);
SELECT public.positioning_region_create('Sorocaba', 'SP', NULL, 'Parque Teste', 'bairro');
SELECT t.como(:plat);
SELECT t.ok((SELECT count(*) FROM public.positioning_region_platform_pending() WHERE nome = 'Parque Teste') = 2, 'A23 plataforma vê os pedidos pendentes');
SELECT t.ok(t.falha(format('SELECT public.positioning_region_decidir(%s, %L)', t.rid('Parque Teste'), 'aprovar'), 'administradores'),
  'A24 plataforma não aprova no lugar da imobiliária');
SELECT t.como(:aUE);
SELECT t.ok(t.falha('SELECT * FROM public.positioning_region_platform_pending()', 'plataforma'), 'A25 admin de imobiliária não vê a fila da plataforma');
-- Juntar com região existente.
SELECT t.ok(public.positioning_region_decidir(t.rid('Parque Teste'), 'juntar', 'É o Campolim', 9001) = 'juntada', 'A26 UE junta com região existente');
SELECT t.ok(t.falha(format('SELECT public.positioning_region_decidir(%s, %L, null, 9004)', t.rid('Parque Teste'), 'juntar'), 'mesma cidade'),
  'A27 não junta com região de outra cidade');
SELECT t.como(:c1UE);
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.my_positioning_regions() WHERE nome = 'Parque Teste'), 'A28 juntada não aparece para o corretor');

-- 4) Editar / desativar região compartilhada --------------------------------------------------------------
SELECT t.como(:aZZ);
SELECT t.ok(t.falha('SELECT public.positioning_region_editar(9001, ''Campolim X'', null, ''bairro'', true)', 'criou'), 'E01 não altera região criada por outra');
SELECT t.ok(t.falha(format('SELECT public.positioning_region_editar(%s, %L, null, %L, false)', t.rid('Jardim Novo'), 'Jardim Novo', 'bairro'), 'outra imobiliaria'),
  'E02 criadora não desativa região usada por corretor de outra imobiliária');
SELECT public.positioning_region_editar(t.rid('Parque Teste'), 'Parque Teste II', 'Sul', 'bairro', true);
SELECT t.ok(t.rid('Parque Teste II') IS NOT NULL, 'E03 criadora renomeia quando ninguém de fora usa');
SELECT t.ok(t.falha(format('SELECT public.positioning_region_editar(%s, %L, null, %L, true)', t.rid('Parque Teste II'), 'campolim', 'bairro'), 'ja existe'),
  'E04 renomear não cria duplicata na cidade');
SELECT t.como(:plat);
SELECT public.positioning_region_editar(t.rid('Jardim Novo'), 'Jardim Novo', 'Sul', 'bairro', true);
SELECT t.ok(true, 'E05 plataforma pode alterar região compartilhada');
SELECT t.como(:aUE);
SELECT t.ok(t.falha(format('SELECT public.positioning_region_decidir(%s, %L, %L)', t.rid('Jardim Novo'), 'recusar', 'mudou'), 'corretor'),
  'E06 não recusa região que corretores da própria imobiliária usam');

-- 5) Sugestão do corretor --------------------------------------------------------------------------------
-- Cidade de uma só imobiliária (Nova Friburgo): a pendente antiga é aprovada, vale na hora e vincula.
SELECT t.como(:aCAP);
SELECT public.review_positioning_region_suggestion('e5000000-0000-0000-0000-00000000aa01', 'aprovar');
SELECT t.dono();
SELECT t.ok(t.st(t.rid('Cônego'), 'remax-capacita') = 'ativa'
        AND (SELECT count(*) FROM public.positioning_region_orgs WHERE region_id = t.rid('Cônego')) = 1, 'S01 cidade de uma só: vale na hora, sem pedidos');
SELECT t.ok(EXISTS (SELECT 1 FROM public.corretor_positioning_regions WHERE corretor_id = :cCAP AND region_id = t.rid('conego')), 'S02 corretor que sugeriu é vinculado');
-- Cidade compartilhada.
SELECT t.como(:c2UE);
SELECT t.ok(t.falha($$SELECT public.submit_positioning_region_suggestion('Sorocaba', null, 'CAMPOLÍM', 'bairro')$$, 'ja esta disponivel'), 'S03 sugestão de região já ativa é barrada');
SELECT public.submit_positioning_region_suggestion('Sorocaba', 'Norte', 'Vila Sugerida', 'bairro');
SELECT t.como(:aZZ);
SELECT t.ok(t.falha($$SELECT public.review_positioning_region_suggestion((SELECT id FROM t.res LIMIT 0), 'aprovar')$$)
        AND NOT EXISTS (SELECT 1 FROM public.positioning_region_suggestions WHERE nome = 'Vila Sugerida'), 'S04 outra imobiliária não vê a sugestão da UE');
SELECT t.como(:c2UE);
SELECT t.ok(t.falha('SELECT public.review_positioning_region_suggestion((SELECT id FROM public.positioning_region_suggestions WHERE nome = ''Vila Sugerida''), ''aprovar'')', 'administradores'),
  'S05 corretor não aprova sugestão');
SELECT t.como(:aUE);
SELECT public.review_positioning_region_suggestion((SELECT id FROM public.positioning_region_suggestions WHERE nome = 'Vila Sugerida'), 'aprovar');
SELECT t.dono();
SELECT t.ok(t.st(t.rid('Vila Sugerida'), 'unica-escolha') = 'ativa' AND t.st(t.rid('Vila Sugerida'), 'zz-teste') = 'pendente'
        AND t.st(t.rid('Vila Sugerida'), 'remax-volute') = 'pendente', 'S06 cidade compartilhada: ativa para a UE, pedido para ZZ e Volute');
SELECT t.ok(EXISTS (SELECT 1 FROM public.corretor_positioning_regions WHERE corretor_id = :c2UE AND region_id = t.rid('Vila Sugerida')), 'S07 corretor da UE vinculado na hora');
SELECT t.como(:aZZ);
SELECT public.positioning_region_decidir(t.rid('Vila Sugerida'), 'recusar', 'Fora da nossa área');
SELECT t.dono();
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.corretor_positioning_regions WHERE region_id = t.rid('Vila Sugerida') AND organization_id = :ZZ)
        AND t.st(t.rid('Vila Sugerida'), 'unica-escolha') = 'ativa', 'S08 recusa não vincula ninguém e não afeta a UE');
-- Rejeitar sugestão não cria região.
SELECT t.como(:c2UE);
SELECT public.submit_positioning_region_suggestion('Sorocaba', null, 'Rejeitavel', 'bairro');
SELECT t.como(:aUE);
SELECT public.review_positioning_region_suggestion((SELECT id FROM public.positioning_region_suggestions WHERE nome = 'Rejeitavel'), 'rejeitar');
SELECT t.dono();
SELECT t.ok(t.rid('Rejeitavel') IS NULL, 'S09 sugestão rejeitada não cria região');
-- Corretor com 2 locais: aprovação cria a região mas não passa do limite.
SELECT t.como(:c1UE);
SELECT public.submit_positioning_region_suggestion('Sorocaba', null, 'Terceiro Local', 'bairro');
SELECT t.como(:aUE);
SELECT public.review_positioning_region_suggestion((SELECT id FROM public.positioning_region_suggestions WHERE nome = 'Terceiro Local'), 'aprovar');
SELECT t.dono();
SELECT t.ok((SELECT count(*) FROM public.corretor_positioning_regions WHERE corretor_id = :c1UE) = 2, 'S10 limite de 2 locais respeitado');

-- Revisão de segurança (t_68769cc7): região aprovada por outra imobiliária, mesmo sem corretor dela, não
-- pode ser renomeada/desativada pela criadora.
SELECT t.como(:aUE);
SELECT public.positioning_region_create('Sorocaba', 'SP', null, 'Regiao Aprovada B', 'bairro');
SELECT t.como(:aZZ);
SELECT public.positioning_region_decidir(t.rid('Regiao Aprovada B'), 'aprovar');
SELECT t.como(:aUE);
SELECT t.ok(t.falha(format('SELECT public.positioning_region_editar(%s, %L, null, %L, false)', t.rid('Regiao Aprovada B'), 'Regiao Aprovada B', 'bairro'), 'aprovada por outra'),
  'E07 criadora não desativa região já aprovada por outra imobiliária (sem corretor dela)');
SELECT t.ok(t.falha(format('SELECT public.positioning_region_editar(%s, %L, null, %L, true)', t.rid('Regiao Aprovada B'), 'Outro Nome', 'bairro'), 'aprovada por outra'),
  'E08 criadora não renomeia região já aprovada por outra imobiliária');
SELECT t.dono();
SELECT t.ok(t.st(t.rid('Regiao Aprovada B'), 'zz-teste') = 'ativa', 'E09 aprovação da ZZ continua valendo');

SELECT t.dono();
SELECT n, CASE WHEN ok THEN 'OK  ' ELSE 'FALHOU' END, label FROM t.res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || '/' || count(*) AS resultado FROM t.res;
ROLLBACK;

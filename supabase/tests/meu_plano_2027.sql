-- Suíte do "Meu Plano 2027" (migration 20261107120000, t_1ac2e95d).
-- Transação revertida, banco local descartável; nunca produção. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'a0000000-0000-4000-8000-000000000001'
\set gestor 'a0000000-0000-4000-8000-000000000002'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'
\set inativo 'a0000000-0000-4000-8000-000000000006'
\set gb 'b0000000-0000-4000-8000-000000000001'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set plat 'f0000000-0000-4000-8000-000000000001'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-plano-a', 'Imobiliaria Exemplo A', 'ativa'),
  (:'org_b', 'teste-plano-b', 'Imobiliaria Exemplo B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'c1', :'c2', :'inativo', :'gb', :'cb', :'plat']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a'),
  (:'gestor', 'Gil Gestor', 'gestor@exemplo.test', true, :'org_a'),
  (:'c1', 'Ana Exemplo', 'c1@exemplo.test', true, :'org_a'),
  (:'c2', 'Bruno Teste', 'c2@exemplo.test', true, :'org_a'),
  (:'inativo', 'Ivo Inativo', 'ivo@exemplo.test', false, :'org_a'),
  (:'gb', 'Gestor B', 'gb@exemplo.test', true, :'org_b'),
  (:'cb', 'Corretor B', 'cb@exemplo.test', true, :'org_b'),
  (:'plat', 'Dono Plataforma', 'plat@exemplo.test', true, :'org_a');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'gestor', true), (:'org_a', :'c1', true), (:'org_a', :'c2', true),
  (:'org_a', :'inativo', true), (:'org_b', :'gb', true), (:'org_b', :'cb', true), (:'org_a', :'plat', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'), (:'c1', 'corretor', :'org_a'),
  (:'c2', 'corretor', :'org_a'), (:'inativo', 'corretor', :'org_a'), (:'gb', 'gestor', :'org_b'),
  (:'cb', 'corretor', :'org_b'), (:'plat', 'super_admin', :'org_a');
INSERT INTO public.platform_admins (user_id) VALUES (:'plat') ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role = origin;

-- 1) Módulo nasce desligado e só a plataforma liga --------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE module = 'meu_plano_2027'),
  'modulo nasce desligado (nenhuma linha criada)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(public.meu_plano_2027_enabled() = false, 'enabled() = false com o modulo desligado');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_salvar(2027, '{"op.0":"100"}')$$) LIKE '42501%',
  'salvar recusado com o modulo desligado');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.platform_set_organization_module(%L, %L, true)', :'org_a', 'meu_plano_2027')) LIKE '42501%',
  'admin da imobiliaria NAO liga o modulo');
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(public.platform_set_organization_module(:'org_a', 'meu_plano_2027', true), 'plataforma liga na org A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.platform_set_organization_module(%L, %L, true)', :'org_a', 'modulo_x')) LIKE '22023%',
  'modulo desconhecido recusado');

-- 2) Corretor salva campos (merge) ---------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(public.meu_plano_2027_enabled(), 'enabled() = true na org A');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"op.0":"3450","op.1":"760"}') IS NOT NULL, 'c1 salva 2 campos');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"op.2":"1080"}') IS NOT NULL, 'c1 salva mais 1 campo');
SELECT pg_temp.ok((SELECT respostas FROM public.carreira_plano WHERE user_id = :'c1')
  = '{"op.0":"3450","op.1":"760","op.2":"1080"}'::jsonb, 'merge: os 3 campos ficam (nenhum apagado)');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"op.1":null,"mk.0":true}') IS NOT NULL, 'null apaga campo');
SELECT pg_temp.ok((SELECT respostas FROM public.carreira_plano WHERE user_id = :'c1')
  = '{"op.0":"3450","op.2":"1080","mk.0":true}'::jsonb, 'op.1 removido e caixa marcada gravada');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_salvar(2027, '{"Op 1":"x"}')$$) LIKE '22023%', 'nome de campo invalido recusado');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_salvar(2027, '{"x;drop":"x"}')$$) LIKE '22023%', 'campo com simbolo recusado');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.creIni":"14","ac.0.1":"3"}') IS NOT NULL, 'campos com maiuscula/3 niveis aceitos');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.creIni":null,"ac.0.1":null}') IS NOT NULL, 'e apagados');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_salvar(2027, '{"a":{"b":1}}')$$) LIKE '22023%', 'valor objeto recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_salvar(2027, jsonb_build_object(%L, repeat(%L, 4001)))', 'pq.frase', 'x')) LIKE '22023%',
  'texto acima de 4000 caracteres recusado');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_salvar(1999, '{"op.0":"1"}')$$) LIKE '22023%', 'ano invalido recusado');

-- Escrita direta na tabela é bloqueada (só RPC).
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_plano (organization_id, user_id, ano) VALUES (%L, %L, 2028)', :'org_a', :'c1')) LIKE '42501%',
  'INSERT direto recusado');
SELECT pg_temp.ok(pg_temp.err($$UPDATE public.carreira_plano SET respostas = '{}'$$) LIKE '42501%', 'UPDATE direto recusado');
SELECT pg_temp.ok(pg_temp.err($$DELETE FROM public.carreira_plano$$) LIKE '42501%', 'DELETE direto recusado');

-- 3) Trilha e início dos 90 dias -----------------------------------------------------------------------------
SELECT pg_temp.ok(public.carreira_plano_trilha(2027, 'ativacao') = (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  'ativacao grava o dia de inicio (hoje, SP)');
SELECT pg_temp.ok(public.carreira_plano_trilha(2027, 'planejamento') IS NOT NULL, 'trocar de trilha mantem a data de inicio');
SELECT pg_temp.ok((SELECT trilha FROM public.carreira_plano WHERE user_id = :'c1') = 'planejamento', 'trilha trocada');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_trilha(2027, 'outra')$$) LIKE '22023%', 'trilha invalida recusada');

-- 4) Leitura: corretor só vê o próprio; broker vê a imobiliária; outra org não vê ---------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"pq.frase":"Sair do aluguel"}') IS NOT NULL, 'c2 salva');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano) = 1, 'c2 ve so o proprio plano');
SELECT pg_temp.ok(pg_temp.err($$SELECT * FROM public.carreira_plano_equipe(2027)$$) LIKE '42501%', 'corretor nao abre a equipe');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_assinar_broker(%L, 2027)', :'c1')) LIKE '42501%', 'corretor nao assina como broker');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano) = 2, 'gestor ve os 2 planos da org A');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano_equipe(2027)) = 3, 'equipe: c1, c2 e o proprio gestor (sem inativo/admin)');
SELECT pg_temp.ok((SELECT respostas->>'pq.frase' FROM public.carreira_plano_equipe(2027) WHERE user_id = :'c2') = 'Sair do aluguel',
  'gestor ve as respostas pessoais (decisao Denis)');
SELECT pg_temp.ok(pg_temp.err($$UPDATE public.carreira_plano SET respostas = '{}'$$) LIKE '42501%', 'gestor nao edita (somente leitura)');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano) = 2, 'admin ve os 2 planos');
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano) = 0, 'gestor da org B nao ve a org A');
SELECT pg_temp.ok(pg_temp.err($$SELECT * FROM public.carreira_plano_equipe(2027)$$) LIKE '42501%', 'org B com o modulo desligado: equipe recusada');
SELECT pg_temp.as_user(:'inativo');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_salvar(2027, '{"op.0":"1"}')$$) LIKE '42501%', 'usuario inativo nao salva');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err($$SELECT * FROM public.carreira_plano$$) LIKE '42501%', 'anon nao le a tabela');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_salvar(2027, '{"op.0":"1"}')$$) LIKE '42501%', 'anon nao executa a RPC');
RESET ROLE;
SET LOCAL ROLE authenticated;

-- Desligar o módulo esconde os planos (RESTRICTIVE) sem apagar nada.
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(public.platform_set_organization_module(:'org_a', 'meu_plano_2027', false) = false, 'plataforma desliga');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano) = 0, 'desligado: gestor nao ve planos');
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(public.platform_set_organization_module(:'org_a', 'meu_plano_2027', true), 'plataforma religa');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano) = 2, 'religado: planos voltam intactos');

-- 5) Pacto ----------------------------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_assinar_broker(%L, 2027)', :'c1')) LIKE '22023%',
  'broker nao assina antes do corretor');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'corretor assina o pacto');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(public.carreira_plano_assinar_broker(:'c1', 2027) IS NOT NULL, 'gestor assina depois do corretor');
SELECT pg_temp.ok((SELECT assinado_broker_por FROM public.carreira_plano WHERE user_id = :'c1') = :'gestor'::uuid, 'quem assinou fica gravado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.carreira_plano_assinar_broker(%L, 2027)', :'cb')) LIKE 'P0002%',
  'broker nao alcanca corretor de outra org');

-- 6) Meta oficial ---------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 588000, 19600000, 28, 127))->>'status' = 'gravada', 'meta gravada sem meta anterior');
SELECT pg_temp.ok((SELECT meta_comissao FROM public.minhas_metas WHERE user_id = :'c1' AND periodo = 'ano' AND inicio = '2027-01-01') = 588000,
  'minhas_metas: ano 2027 com o VGC do plano');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 600000, NULL, 30, 130))->>'status' = 'existe', 'ja existe: pede confirmacao');
SELECT pg_temp.ok((SELECT meta_comissao FROM public.minhas_metas WHERE user_id = :'c1' AND periodo = 'ano' AND inicio = '2027-01-01') = 588000,
  'sem confirmacao nada muda');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 600000, NULL, 30, 130, true))->>'status' = 'gravada', 'com confirmacao substitui');
SELECT pg_temp.ok((SELECT meta_vendas FROM public.minhas_metas WHERE user_id = :'c1' AND periodo = 'ano' AND inicio = '2027-01-01') = 30,
  'meta substituida');
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_metas WHERE user_id = :'c1') = 1, 'uma unica meta anual (sem duplicar)');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_usar_meta(2027, -1, NULL, NULL, NULL)$$) LIKE '22023%', 'meta negativa recusada');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_usar_meta(2027, NULL, NULL, NULL, NULL)$$) LIKE '22023%', 'meta vazia recusada');

-- 7) Números da p.14 -----------------------------------------------------------------------------------------
SELECT pg_temp.ok((public.carreira_plano_meus_numeros()) ? 'ativos', 'meus_numeros responde (sem vendas = zeros)');

-- 8) Taxas do funil: padrão da imobiliária (admin/gestor) e ajuste do corretor -------------------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_taxas (organization_id, user_id, funil_v2_cre, funil_v1_v2, funil_folga) VALUES (%L, NULL, 40, 55, 30)', :'org_a')) IS NULL,
  'gestor grava o padrao da imobiliaria');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((SELECT funil_v2_cre FROM public.carreira_taxas WHERE user_id IS NULL) = 40, 'corretor le o padrao');
SELECT pg_temp.ok(pg_temp.err(format('INSERT INTO public.carreira_taxas (organization_id, user_id, funil_v2_cre) VALUES (%L, %L, 70)', :'org_a', :'c1')) IS NULL,
  'corretor grava o proprio ajuste');
SELECT pg_temp.ok(pg_temp.err($$UPDATE public.carreira_taxas SET funil_v2_cre = 10 WHERE user_id IS NULL$$) IS NULL
  AND (SELECT funil_v2_cre FROM public.carreira_taxas WHERE user_id IS NULL) = 40, 'corretor NAO altera o padrao');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.carreira_taxas SET funil_v2_cre = 150 WHERE user_id = %L', :'c1')) LIKE '23514%', 'taxa acima de 100 recusada');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;

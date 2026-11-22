-- Suíte da RPC venda_salvar_resumo (migration 20261222120000, t_8ab6c348; Denis 22/11/2026, tópico 6238).
-- Transação revertida, banco local descartável ou homologação; nunca produção. Dados fictícios.
-- O runner define pg_temp.salvar(venda, patch, extras, remover) ANTES deste arquivo:
--   modo normal  -> chama a RPC nova (uma transação: tudo ou nada);
--   MODO=antigo  -> repete o jeito antigo do navegador (cada passo é uma requisição separada) e TEM de falhar
--                   nas checagens "nada gravado".
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
-- Estado da venda + extras numa linha (para provar que nada mudou).
CREATE FUNCTION pg_temp.estado(_sale uuid) RETURNS text LANGUAGE sql AS $$
  SELECT md5(coalesce((SELECT (to_jsonb(s) - 'updated_at')::text FROM public.sales s WHERE s.id = _sale), '')
     || coalesce((SELECT string_agg(to_jsonb(e)::text, '|' ORDER BY e.id) FROM public.sale_commission_extras e
                  WHERE e.sale_id = _sale), '')) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a5000000-0000-4000-8000-0000000000a0'
\set org_b 'b5000000-0000-4000-8000-0000000000b0'
\set dono 'a5000000-0000-4000-8000-000000000001'
\set outro 'a5000000-0000-4000-8000-000000000002'
\set cb 'b5000000-0000-4000-8000-000000000001'
\set venda 'a5000000-0000-4000-8000-00000000f001'
\set extra_velho 'a5000000-0000-4000-8000-00000000e001'
\set extra_fica 'a5000000-0000-4000-8000-00000000e002'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-vsr-a', 'Imobiliaria VSR A', 'ativa'),
  (:'org_b', 'teste-vsr-b', 'Imobiliaria VSR B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'dono', :'outro', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'dono', 'Dono VSR', 'dono@vsr.test', true, :'org_a'),
  (:'outro', 'Outro VSR', 'outro@vsr.test', true, :'org_a'),
  (:'cb', 'Corretor B VSR', 'cb@vsr.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'dono', true), (:'org_a', :'outro', true), (:'org_b', :'cb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'dono', 'corretor', :'org_a'), (:'outro', 'corretor', :'org_a'), (:'cb', 'corretor', :'org_b');
INSERT INTO public.sales (id, organization_id, corretor_id, status, imovel_id, valor_total_comissao, matricula,
                          corretor_captador, corretor_captador_id)
  VALUES (:'venda', :'org_a', :'dono', 'rascunho', 'VSR-1', 10000, 'mat-original', 'Dono VSR', :'dono');
INSERT INTO public.sale_commission_extras (id, sale_id, organization_id, nome, papel, origem, valor) VALUES
  (:'extra_velho', :'venda', :'org_a', 'Parceiro que sai', 'outro', 'imobiliaria', 300),
  (:'extra_fica', :'venda', :'org_a', 'Parceiro que fica', 'outro', 'imobiliaria', 200);
SET LOCAL session_replication_role = origin;

SELECT pg_temp.estado(:'venda') AS estado_inicial \gset

SET LOCAL ROLE authenticated;

-- ===== 1) Falha NO MEIO: venda alterada + 1 extra removido + 1 extra novo válido + 1 extra vazio (o banco recusa).
SELECT pg_temp.as_user(:'dono');
SELECT pg_temp.salvar(:'venda',
  '{"valor_total_comissao": 99999, "matricula": "mat-meio"}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('id', :'extra_fica', 'nome', 'Parceiro que fica', 'papel', 'outro', 'valor', 250),
    jsonb_build_object('nome', 'Parceiro novo', 'papel', 'outro', 'valor', 100),
    jsonb_build_object('nome', '', 'papel', 'outro', 'valor', 50)),
  ARRAY[:'extra_velho']::uuid[]) AS erro_meio \gset
SELECT pg_temp.ok(:'erro_meio' LIKE '23514%', 'falha no meio devolve o erro do banco (23514 extra vazio)');
SELECT pg_temp.ok((SELECT matricula FROM public.sales WHERE id = :'venda') = 'mat-original'
               AND (SELECT valor_total_comissao FROM public.sales WHERE id = :'venda') = 10000,
  'falha no meio: a venda NÃO foi alterada (nada gravado)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.sale_commission_extras WHERE id = :'extra_velho'),
  'falha no meio: o extra removido continua lá (nada gravado)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.sale_commission_extras WHERE sale_id = :'venda' AND nome = 'Parceiro novo'),
  'falha no meio: o extra novo NÃO ficou gravado pela metade');
SELECT pg_temp.ok((SELECT valor FROM public.sale_commission_extras WHERE id = :'extra_fica') = 200,
  'falha no meio: o extra alterado continua com o valor antigo');
SELECT pg_temp.ok(pg_temp.estado(:'venda') = :'estado_inicial', 'falha no meio: venda + extras idênticos ao início');

-- ===== 2) Sucesso: mesmo pedido sem a linha vazia grava tudo, na ordem da tela.
SELECT pg_temp.salvar(:'venda',
  '{"valor_total_comissao": 12000, "matricula": "mat-nova", "quartos": 3}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('id', :'extra_fica', 'nome', 'Parceiro que fica', 'papel', 'outro', 'valor', 250),
    jsonb_build_object('nome', 'Parceiro novo', 'papel', 'outro', 'valor', 100, 'origem', 'vendedor')),
  ARRAY[:'extra_velho']::uuid[]) AS erro_ok \gset
SELECT pg_temp.ok(:'erro_ok' = 'OK', 'sucesso: salvar sem erro');
SELECT pg_temp.ok((SELECT matricula = 'mat-nova' AND valor_total_comissao = 12000 AND quartos = 3
                   AND corretor_captador_id = :'dono' FROM public.sales WHERE id = :'venda'),
  'sucesso: a venda grava só os campos enviados (os outros ficam iguais)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.sale_commission_extras WHERE id = :'extra_velho'),
  'sucesso: o extra removido saiu');
SELECT pg_temp.ok((SELECT valor FROM public.sale_commission_extras WHERE id = :'extra_fica') = 250,
  'sucesso: o extra alterado ficou com o valor novo');
SELECT pg_temp.ok((SELECT count(*) FROM public.sale_commission_extras WHERE sale_id = :'venda' AND nome = 'Parceiro novo'
                   AND origem = 'vendedor' AND organization_id = :'org_a') = 1,
  'sucesso: o extra novo foi incluído uma vez, na imobiliária da venda');

-- ===== 3) Acesso (só no modo normal: são regras da RPC nova).
\if :modo_normal
SELECT public.venda_salvar_resumo(:'venda', '{}'::jsonb, NULL, '{}') -> 'extras' AS r3 \gset
SELECT pg_temp.ok(:'r3' = '[]', 'sem extras na chamada: não mexe nos extras (devolve lista vazia)');
SELECT pg_temp.ok((SELECT count(*) FROM public.sale_commission_extras WHERE sale_id = :'venda') = 2,
  'sem extras na chamada: os 2 extras continuam');
SELECT (public.venda_salvar_resumo(:'venda', '{}'::jsonb,
  jsonb_build_array(jsonb_build_object('nome', 'Ordem 1', 'papel', 'outro'),
                    jsonb_build_object('nome', 'Ordem 2', 'papel', 'outro')), '{}') -> 'extras') AS ids \gset
SELECT pg_temp.ok((SELECT nome FROM public.sale_commission_extras WHERE id = ((:'ids'::jsonb) ->> 0)::uuid) = 'Ordem 1'
              AND (SELECT nome FROM public.sale_commission_extras WHERE id = ((:'ids'::jsonb) ->> 1)::uuid) = 'Ordem 2',
  'os ids voltam na mesma ordem da tela (a tela troca o id temporário pelo real)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.venda_salvar_resumo(%L, %L::jsonb)', :'venda', '{"status":"aprovada_gestor"}')) LIKE '22023%',
  'etapa (status) não muda por aqui');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.venda_salvar_resumo(%L, %L::jsonb)', :'venda', '{"organization_id":"b5000000-0000-4000-8000-0000000000b0"}')) LIKE '22023%',
  'imobiliária da venda não muda por aqui');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.venda_salvar_resumo(%L, %L::jsonb)', :'venda', '{"corretor_id":"a5000000-0000-4000-8000-000000000002"}')) LIKE '22023%',
  'dono do rascunho não muda por aqui');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.venda_salvar_resumo(%L, %L::jsonb)', :'venda', '{"coluna_que_nao_existe":1}')) LIKE '22023%',
  'campo que não existe é recusado (nada de SQL montado com nome livre)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.venda_salvar_resumo(%L, %L::jsonb)', :'venda', '{"matricula = $$x$$; --":1}')) LIKE '22023%',
  'nome de campo com SQL embutido é recusado');

-- Outra pessoa da mesma imobiliária, sem acesso ao rascunho: não enxerga a venda.
SELECT pg_temp.as_user(:'outro');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.venda_salvar_resumo(%L, %L::jsonb)', :'venda', '{"matricula":"invasor"}')) LIKE '42501%',
  'corretor sem acesso ao rascunho: 42501, nada gravado');
-- Corretor de OUTRA imobiliária.
SELECT pg_temp.as_user(:'cb');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.venda_salvar_resumo(%L, %L::jsonb)', :'venda', '{"matricula":"invasor"}')) LIKE '42501%',
  'corretor de outra imobiliária: 42501, nada gravado');
RESET ROLE;
SELECT pg_temp.ok((SELECT matricula FROM public.sales WHERE id = :'venda') = 'mat-nova', 'tentativas sem acesso não gravaram');
-- Sem login (anon) não executa.
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.venda_salvar_resumo(%L)', :'venda')) LIKE '42501%', 'anon: sem permissão de executar');
RESET ROLE;
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.venda_salvar_resumo(uuid,jsonb,jsonb,uuid[])', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.venda_salvar_resumo(uuid,jsonb,jsonb,uuid[])', 'EXECUTE'),
  'grants: só authenticated (anon e public sem execute)');
SELECT pg_temp.ok((SELECT NOT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
                    WHERE oid = 'public.venda_salvar_resumo(uuid,jsonb,jsonb,uuid[])'::regprocedure),
  'função roda com o papel de quem chama (regras de acesso valem) e search_path vazio');
\endif

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;

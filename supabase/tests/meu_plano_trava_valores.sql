-- Suíte da trava de valores do Meu Plano 2027 (migration 20261209120000, t_125c4dd3).
-- Transação revertida (homologação ou banco descartável; nunca produção). Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
-- Grava as respostas direto (como o plano antigo já gravado) e zera a assinatura.
CREATE FUNCTION pg_temp.plano(_uid uuid, _r jsonb, _assinado boolean DEFAULT false) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.carreira_plano (organization_id, user_id, ano, respostas, assinado_corretor_em)
  VALUES ('a0000000-0000-4000-8000-0000000000a0', _uid, 2027, _r, CASE WHEN _assinado THEN now() END)
  ON CONFLICT (organization_id, user_id, ano) DO UPDATE SET respostas = EXCLUDED.respostas,
    assinado_corretor_em = EXCLUDED.assinado_corretor_em $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES (:'org_a', 'teste-trava-a', 'Imobiliaria Exemplo A', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'c1', :'c2']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'c1', 'Ana Exemplo', 'c1@exemplo.test', true, :'org_a'),
  (:'c2', 'Bruno Teste', 'c2@exemplo.test', true, :'org_a');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES (:'org_a', :'c1', true), (:'org_a', :'c2', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (:'org_a', 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
SET LOCAL session_replication_role = origin;

-- 1) Funções auxiliares: só uso interno ------------------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.carreira_plano_trava(jsonb)', 'EXECUTE'),
  'trava() nao e chamavel por authenticated');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.carreira_plano_num(jsonb)', 'EXECUTE'),
  'num() nao e chamavel por anon');
SELECT pg_temp.ok(public.carreira_plano_num('"42.000,00"') = 42000 AND public.carreira_plano_num('"45..000"') IS NULL
  AND public.carreira_plano_num('"3%"') = 3 AND public.carreira_plano_num('"R$ 1.000.000"') = 1000000, 'num() le padrao BR');

-- 2) Regra pura (planos reais anonimizados) -------------------------------------------------------------------
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.tCapt":"42.000,00","mt.tVenda":"42.000,00","mt.comMedia":"8100,00"}') LIKE '%não é um número inteiro%',
  'trava: 42.000,00 (vírgula/ponto) recusa');
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.tCapt":"1500000","mt.tVenda":"10","mt.comMedia":"3"}') LIKE '1500000 transações de captação%',
  'trava: 1500000 captações recusa');
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.tCapt":"10","mt.tVenda":"45..000"}') LIKE '%"45..000" não é um número inteiro%',
  'trava: 45..000 recusa');
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.tCapt":"500","mt.tVenda":"500","mt.comMedia":"5000"}') IS NULL,
  'trava: 500 + 500 transações (limite exato) e VGC 5 mi exato passa');
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.tCapt":"501"}') LIKE '501 %',
  'trava: 501 recusa');
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.tCapt":"44","mt.tVenda":"40","m.ticket":"1.000.000","m.pct":"6"}') LIKE 'Meta de comissão%',
  'trava: VGC 5,04 mi (ticket × %) recusa');
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.tCapt":"120","mt.tVenda":"60","mt.novas":"300","mt.comMedia":"24000"}') IS NULL,
  'trava: plano alto legitimo (180 transacoes, VGC 4,32 mi) passa');
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.tCapt":"10","mt.tVenda":"10","mt.comMedia":"10000","m.ticket":"250"}') IS NULL,
  'trava: ticket baixo so avisa (nao bloqueia no servidor)');
SELECT pg_temp.ok(public.carreira_plano_trava('{}') IS NULL AND public.carreira_plano_trava(NULL) IS NULL, 'trava: vazio passa');
SELECT pg_temp.ok(public.carreira_plano_trava('{"mt.novas":" 24 ","mt.creFim":24}') IS NULL, 'trava: numero JSON e espacos passam');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');

-- 3) Rascunho continua salvando qualquer coisa ----------------------------------------------------------------
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.tCapt":"42.000,00","mt.tVenda":"42.000,00","mt.comMedia":"8100"}') IS NOT NULL,
  'rascunho com valor absurdo e salvo');

-- 4) Assinar recusa; corrigir libera --------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_plano_assinar(2027)') LIKE '22023%Plano com valor fora do limite%',
  'assinar recusa 42.000,00 (22023)');
SELECT pg_temp.ok((SELECT assinado_corretor_em IS NULL FROM public.carreira_plano WHERE user_id = :'c1'), 'continua sem assinatura');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.tCapt":"44","mt.tVenda":"40","mt.comMedia":"60000"}') IS NOT NULL,
  'salva VGC 5,04 mi');
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_plano_assinar(2027)') LIKE '%acima de R$ 5 milhões%', 'assinar recusa VGC 5,04 mi');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.comMedia":"59523,80"}') IS NOT NULL, 'salva VGC 4.999.999,20');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'VGC abaixo de 5 mi assina');

-- 5) Meta oficial: teto de R$ 5 mi e 1.000 transações ---------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_plano_usar_meta(2027, 5000000.01, NULL, 84, 13, true)') LIKE '22023%acima de R$ 5 milhões%',
  'usar_meta recusa 5.000.000,01');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 5000000, NULL, 84, 13, true))->>'status' = 'gravada', 'usar_meta aceita 5.000.000 exato');
SELECT pg_temp.ok(pg_temp.err('SELECT public.carreira_plano_usar_meta(2027, 600000, NULL, 1001, 13, true)') LIKE '22023%1.000 transações%',
  'usar_meta recusa 1.001 transacoes');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 600000, NULL, 1000, 13, true))->>'status' = 'gravada', 'usar_meta aceita 1.000 exato');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 432000, 9000000, 36, 24, true))->>'status' = 'gravada', 'meta normal gravada');

-- 6) Plano ANTIGO já assinado acima do limite: continua assinado, nada muda ------------------------------------
RESET ROLE;
SELECT pg_temp.plano(:'c2'::uuid, '{"mt.tCapt":"42.000,00","mt.tVenda":"42.000,00","mt.comMedia":"8100,00"}', true);
CREATE TEMP TABLE antes AS SELECT md5(row(respostas, assinado_corretor_em)::text) h FROM public.carreira_plano WHERE user_id = :'c2';
GRANT ALL ON antes TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'plano antigo ja assinado: assinar de novo nao da erro (nao reabre)');
SELECT pg_temp.ok((SELECT md5(row(respostas, assinado_corretor_em)::text) FROM public.carreira_plano WHERE user_id = :'c2') = (SELECT h FROM antes),
  'plano antigo: respostas e data da assinatura intactas');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.tCapt":"20","mt.tVenda":"20"}') IS NOT NULL,
  'plano antigo assinado pode ser corrigido');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;

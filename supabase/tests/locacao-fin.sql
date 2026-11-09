-- Suíte da migration 20261111120000 (Locação Fase 2 — Financeiro parte 1, t_be750361). Roda DENTRO de transação
-- revertida (run-locacao-fin.sh). Dados fictícios só na transação; nada fica gravado; nada é enviado a ninguém.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0). Perfis: adm (QA A Admin), ffin (UE Corretor → papel
-- 'financeiro' da locação), fin (QA A Financeiro: app_role global 'financeiro', SEM papel da locação), c2 (QA A
-- Corretor Dois, corretor), vis (QA A Corretor Um → papel vistoria), admB (QA B Admin).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
CREATE TEMP TABLE dt(k text PRIMARY KEY, v date);
GRANT ALL ON r, ids, js, dt TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.d(_k text) RETURNS date LANGUAGE sql AS $$ SELECT v FROM dt WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
-- Cobrança de um contrato numa competência (lida como superusuário, fora do papel).
CREATE FUNCTION pg_temp.cob(_ct uuid, _comp date) RETURNS public.locacao_cobrancas LANGUAGE sql AS $$
  SELECT * FROM public.locacao_cobrancas WHERE contrato_id = _ct AND competencia = _comp $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('vis', '5745cbff-22b6-4a28-a515-dd6706504b8b'), ('ffin', '10000000-0000-4000-8000-000000000003'),
  ('fin', 'b5ac36b2-ed7e-4bad-8c7f-4bfbf69ad6ed'), ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'),
  ('Lant', '7b000000-0000-4000-8000-000000000001');
INSERT INTO dt VALUES ('hoje', (now() AT TIME ZONE 'America/Sao_Paulo')::date);
INSERT INTO dt VALUES ('m0', date_trunc('month', pg_temp.d('hoje'))::date),
  ('m1', (date_trunc('month', pg_temp.d('hoje')) - interval '1 month')::date),
  ('mp', (date_trunc('month', pg_temp.d('hoje')) + interval '1 month')::date);

-- 0) Estrutura ---------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FILTER (WHERE c.relrowsecurity) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('locacao_fin_config', 'locacao_contratos', 'locacao_cobrancas', 'locacao_fin_descontos', 'locacao_repasses',
                     'locacao_fin_eventos')) = 6, 'as 6 tabelas novas com RLS ligada');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public'
   AND table_name IN ('locacao_fin_config', 'locacao_contratos', 'locacao_cobrancas', 'locacao_fin_descontos', 'locacao_repasses',
                      'locacao_fin_eventos') AND grantee IN ('anon', 'authenticated', 'PUBLIC')), 'nenhum grant de tabela a anon/authenticated');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'locacao%' AND has_function_privilege('anon', p.oid, 'EXECUTE')), 'nenhuma função locacao_* executável por anon');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname LIKE 'locacao_fin%' AND p.prosecdef AND NOT coalesce('search_path=""' = ANY (p.proconfig), false)),
  'toda função SECURITY DEFINER nova com search_path vazio');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_fin_ctx()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_fin_evento(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_fin_criar_contrato(public.locacoes)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.locacao_fin_repasse_calc(public.locacao_cobrancas)', 'EXECUTE'),
  'funções internas (contexto, histórico, criar contrato, cálculo) não são chamáveis pelo navegador');
SELECT pg_temp.ok((SELECT situacao = 'a_completar' AND garantia = 'caucao' AND aluguel = 1500 AND taxa_adm = 8
   AND inicio = pg_temp.d('hoje') - 20 AND proximo_reajuste = (pg_temp.d('hoje') - 20 + interval '1 year')::date AND indice = 'IGP-M'
   FROM public.locacao_contratos WHERE locacao_id = pg_temp.id('Lant')),
  'locação que já tinha chave entregue ganha contrato "a completar" na migration (valores da esteira, reajuste em 1 ano)');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_cobrancas) = 0, 'migration não gera nenhuma cobrança sozinha');

-- 1) Papel 'financeiro' da locação (não a app_role global) ---------------------------------------------------------
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgB'), 'locacao', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ffin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_painel(NULL)') LIKE '42501%Financeiro%', 'sem o papel: painel financeiro recusado');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_papel_definir(%L, ''financeiro'', true)', pg_temp.id('c2'))) LIKE '42501%',
  'corretor não se dá o papel financeiro');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_papel_definir(pg_temp.id('ffin'), 'financeiro', true);
SELECT public.locacao_papel_definir(pg_temp.id('vis'), 'vistoria', true);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_papel_definir(%L, ''financeiro'', true)', pg_temp.id('admB'))) LIKE '42501%',
  'admin não dá papel financeiro a pessoa de outra imobiliária');
SELECT pg_temp.as_user(pg_temp.id('ffin')::text);
SELECT pg_temp.ok(public.locacao_contexto()->'papeis' = '["financeiro"]'::jsonb, 'contexto mostra o papel financeiro');
SELECT pg_temp.ok(jsonb_array_length(public.locacao_lista()) = 0, 'papel financeiro sozinho NÃO vê a esteira (Fase 1)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_detalhe(%L)', pg_temp.id('Lant'))) LIKE '42501%',
  'papel financeiro não abre a locação da esteira');
SELECT pg_temp.put('P', public.locacao_fin_painel(NULL));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('P')->'contratos') = 1 AND (pg_temp.j('P')->>'competencia')::date = pg_temp.d('m0'),
  'financeiro vê o painel: 1 contrato e competência do mês atual');
SELECT pg_temp.ok((pg_temp.j('P')->'config'->>'multa_pct')::numeric = 10 AND (pg_temp.j('P')->'config'->>'juros_pct_mes')::numeric = 1
  AND (pg_temp.j('P')->'config'->>'dias_repasse')::int = 5 AND pg_temp.j('P')->'config'->>'indice' = 'IGP-M'
  AND (pg_temp.j('P')->'config'->>'retem_primeiro_aluguel')::boolean,
  'regras de exemplo (a confirmar) sem configurar nada: multa 10%, juros 1% a.m., repasse D+5, IGP-M, retém 1º aluguel');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_painel(NULL)') LIKE '42501%',
  'app_role global "financeiro" SEM o papel da locação não entra no financeiro da locação');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_painel(NULL)') LIKE '42501%', 'corretor não vê o financeiro');
SELECT pg_temp.as_user(pg_temp.id('vis')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_painel(NULL)') LIKE '42501%', 'papel vistoria não vê o financeiro');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_fin_painel(NULL)->'contratos') = 1, 'administrador age no papel financeiro');
RESET ROLE;

-- 2) Contrato nasce na entrega das chaves (pela RPC da Fase 1) -------------------------------------------------------
INSERT INTO public.locacoes (id, organization_id, corretor_id, etapa, candidato, endereco, garantia, aluguel, condominio, iptu, taxa_adm)
VALUES ('7b000000-0000-4000-8000-000000000002', pg_temp.id('orgA'), pg_temp.id('c2'), 'chaves',
  '{"nome":"Bruno Testa (fictício)"}', 'Rua das Acácias Fictícia, 120 — ap. 34, Sorocaba/SP', 'fiador', 1900, 300, 50, 10);
SELECT pg_temp.setid('L', '7b000000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('vis')::text);
SELECT public.locacao_pos_acao(pg_temp.id('L'), 'entregar_chaves', jsonb_build_object('data', pg_temp.d('hoje') - 40));
RESET ROLE;
SELECT pg_temp.setid('CT', (SELECT id FROM public.locacao_contratos WHERE locacao_id = pg_temp.id('L')));
SELECT pg_temp.ok((SELECT situacao = 'a_completar' AND aluguel = 1900 AND taxa_adm = 10 AND condominio = 300 AND iptu = 50
   AND inicio = pg_temp.d('hoje') - 40 AND inquilino_nome = 'Bruno Testa (fictício)' AND garantia = 'fiador'
   FROM public.locacao_contratos WHERE id = pg_temp.id('CT')),
  'entrega das chaves cria o contrato "a completar" com aluguel, taxa, condomínio, IPTU, garantia e início da esteira');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_fin_eventos WHERE contrato_id = pg_temp.id('CT') AND acao = 'contrato_criado') = 1,
  'criação do contrato fica no histórico financeiro');
UPDATE public.locacoes SET chave_em = chave_em WHERE id = pg_temp.id('L');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_contratos WHERE locacao_id = pg_temp.id('L')) = 1, 'não duplica contrato');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ffin')::text);
SELECT pg_temp.ok((public.locacao_fin_gerar_cobrancas(pg_temp.d('m1'))->>'geradas')::int = 0,
  'contrato "a completar" não gera cobrança');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_contrato_ativar(%L)', pg_temp.id('CT'))) LIKE '22023%Preencha%proprietário%',
  'ativar sem proprietário/dados de repasse é recusado (lista o que falta)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_contrato_salvar(%L, %L)', pg_temp.id('CT'), '{"senha":"x"}')) LIKE '22023%',
  'campo fora da lista é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_contrato_salvar(%L, %L)', pg_temp.id('CT'), '{"dia_vencimento":31}')) LIKE '22023%',
  'dia de vencimento 31 é recusado (1 a 28)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_contrato_salvar(%L, %L)', pg_temp.id('CT'), '{"aluguel":-1}')) LIKE '22023%',
  'aluguel negativo é recusado');
SELECT public.locacao_fin_contrato_salvar(pg_temp.id('CT'), jsonb_build_object('proprietario_nome', 'Helena Exemplo (fictícia)',
  'proprietario_doc', '000.000.000-01', 'dados_repasse', 'Banco fictício 000, ag 0000, cc 00000-0', 'aluguel', 2000,
  'dia_vencimento', 5, 'inicio', pg_temp.d('m1') + 4, 'proximo_reajuste', (pg_temp.d('m1') + 4 + interval '1 year')::date));
RESET ROLE;
SELECT pg_temp.ok((SELECT dados ? 'aluguel' AND (dados->'aluguel'->>'para')::numeric = 2000 FROM public.locacao_fin_eventos
   WHERE contrato_id = pg_temp.id('CT') AND acao = 'contrato_editado' ORDER BY id DESC LIMIT 1),
  'edição do contrato registra o "de → para" no histórico');
SET LOCAL ROLE authenticated;
SELECT pg_temp.put('CTA', public.locacao_fin_contrato_ativar(pg_temp.id('CT')));
SELECT pg_temp.ok(pg_temp.j('CTA')->>'situacao' = 'ativo' AND pg_temp.j('CTA')->>'codigo' LIKE 'CT-%', 'contrato ativado (CT-xxxx)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_contrato_ativar(%L)', pg_temp.id('CT'))) LIKE '22023%', 'não ativa duas vezes');

-- 3) Cobranças mensais --------------------------------------------------------------------------------------------
SELECT pg_temp.ok((public.locacao_fin_gerar_cobrancas(pg_temp.d('m1'))->>'geradas')::int = 1, 'gera a cobrança do mês anterior (1 contrato ativo)');
SELECT pg_temp.ok((public.locacao_fin_gerar_cobrancas(pg_temp.d('m1'))->>'geradas')::int = 0, 'gerar de novo não duplica');
SELECT pg_temp.ok((public.locacao_fin_gerar_cobrancas(pg_temp.d('m0') + 10)->>'geradas')::int = 1, 'gera a do mês atual (qualquer dia vira o mês)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_gerar_cobrancas(%L)', pg_temp.d('m0') + 400)) LIKE '22023%',
  'competência muito à frente é recusada');
RESET ROLE;
SELECT pg_temp.setid('C1', (pg_temp.cob(pg_temp.id('CT'), pg_temp.d('m1'))).id);
SELECT pg_temp.setid('C0', (pg_temp.cob(pg_temp.id('CT'), pg_temp.d('m0'))).id);
SELECT pg_temp.ok((SELECT valor = 2350 AND aluguel = 2000 AND condominio = 300 AND iptu = 50 AND vencimento = pg_temp.d('m1') + 4
   AND primeiro_aluguel AND status = 'aberta' FROM public.locacao_cobrancas WHERE id = pg_temp.id('C1')),
  'cobrança: aluguel + condomínio + IPTU = 2.350, vence dia 5, marcada como 1º aluguel');
SELECT pg_temp.ok((SELECT NOT primeiro_aluguel FROM public.locacao_cobrancas WHERE id = pg_temp.id('C0')), 'mês seguinte não é 1º aluguel');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ffin')::text);
SELECT pg_temp.put('P', public.locacao_fin_painel(pg_temp.d('m1')));
SELECT pg_temp.ok((SELECT x->>'situacao' = 'atraso' AND (x->>'dias_atraso')::int > 0 AND (x->'encargos_hoje'->>'multa')::numeric = 200
   FROM jsonb_array_elements(pg_temp.j('P')->'cobrancas') x),
  'cobrança vencida aparece "em atraso" com multa calculada (10% de 2.000 = 200)');

-- 4) Baixa manual com multa e juros ---------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_baixa(%L, %L, 2500, NULL)', pg_temp.id('C1'), pg_temp.d('m1') + 14))
  LIKE '22023%diferente do devido (2556.67)%', 'valor pago diferente do devido sem explicação é recusado (devido 2.556,67)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_baixa(%L, %L, 2556.67, NULL)', pg_temp.id('C1'), pg_temp.d('hoje') + 1))
  LIKE '22023%', 'data de pagamento no futuro é recusada');
SELECT pg_temp.put('B1', public.locacao_fin_baixa(pg_temp.id('C1'), pg_temp.d('m1') + 14, 2556.67, NULL));
SELECT pg_temp.ok(pg_temp.j('B1')->>'status' = 'paga' AND (pg_temp.j('B1')->>'multa')::numeric = 200
  AND (pg_temp.j('B1')->>'juros')::numeric = 6.67 AND (pg_temp.j('B1')->'regra_encargos'->>'dias')::int = 10
  AND (pg_temp.j('B1')->'regra_encargos'->>'multa_pct')::numeric = 10,
  'baixa 10 dias atrasada: multa 200 + juros 6,67 (1% a.m. ÷ 30 × 10), regra usada gravada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_baixa(%L, %L, 2556.67, NULL)', pg_temp.id('C1'), pg_temp.d('m1') + 14))
  LIKE '22023%', 'não dá baixa duas vezes');

-- 5) Repasse ---------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok((pg_temp.j('B1')->'repasse_calc'->>'total')::numeric = 256.67
  AND (pg_temp.j('B1')->'repasse_calc'->>'retencao_primeiro')::boolean
  AND (pg_temp.j('B1')->'repasse_calc'->>'previsto')::date = pg_temp.d('m1') + 19,
  '1º aluguel: 2.000 − 2.000 (retenção) + 206,67 (multa/juros do proprietário) + 50 (IPTU) = 256,67; previsto D+5');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_desconto(%L, ''x'', 10)', pg_temp.id('C1'))) LIKE '22023%',
  'desconto sem descrição é recusado');
SELECT public.locacao_fin_desconto(pg_temp.id('C1'), 'Conserto hidráulico autorizado (fictício)', 180);
SELECT pg_temp.ok((SELECT (x->'repasse_calc'->>'total')::numeric = 76.67 FROM jsonb_array_elements(public.locacao_fin_painel(pg_temp.d('m1'))->'cobrancas') x),
  'desconto de 180 entra no repasse: 76,67');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_repasse_feito(%L, %L, NULL)', pg_temp.id('C1'), pg_temp.d('m1') + 10))
  LIKE '22023%', 'repasse com data antes do pagamento é recusado');
SELECT pg_temp.put('R1', public.locacao_fin_repasse_feito(pg_temp.id('C1'), pg_temp.d('hoje'), 'PIX-FICTICIO-001'));
SELECT pg_temp.ok((pg_temp.j('R1')->>'valor')::numeric = 76.67, 'repasse feito registrado com o valor calculado (76,67)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_repasse_feito(%L, %L, NULL)', pg_temp.id('C1'), pg_temp.d('hoje')))
  LIKE '22023%', 'não registra repasse duas vezes');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_desconto(%L, ''Outro desconto'', 10)', pg_temp.id('C1'))) LIKE '22023%Repasse já feito%',
  'depois do repasse não entra desconto novo');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_estornar(%L, ''lançado errado'')', pg_temp.id('C1'))) LIKE '22023%Repasse já feito%',
  'não desfaz baixa com repasse feito');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_repasse_desfazer(%L, '''')', (pg_temp.j('R1')->>'id')::uuid)) LIKE '22023%motivo%',
  'desfazer repasse exige motivo');
SELECT public.locacao_fin_repasse_desfazer((pg_temp.j('R1')->>'id')::uuid, 'Registrado no contrato errado (teste)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_estornar(%L, '''')', pg_temp.id('C1'))) LIKE '22023%motivo%',
  'desfazer baixa exige motivo');
SELECT pg_temp.put('E1', public.locacao_fin_estornar(pg_temp.id('C1'), 'Baixa lançada com data errada (teste)'));
SELECT pg_temp.ok(pg_temp.j('E1')->>'status' = 'aberta' AND (pg_temp.j('E1')->>'multa')::numeric = 0, 'baixa desfeita: volta a aberta, encargos zerados');
RESET ROLE;
SELECT pg_temp.ok((SELECT desfeito_em IS NOT NULL AND valor = 76.67 FROM public.locacao_repasses WHERE id = (pg_temp.j('R1')->>'id')::uuid),
  'repasse desfeito continua guardado (não é apagado)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ffin')::text);

-- 6) Regras configuráveis ---------------------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_config_salvar(''{"multa_pct":50}'')') LIKE '22023%', 'multa acima de 20% é recusada');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_config_salvar(''{"cor":"azul"}'')') LIKE '22023%', 'regra desconhecida é recusada');
SELECT public.locacao_fin_config_salvar('{"multa_pct":2,"multa_para":"imobiliaria"}');
SELECT pg_temp.put('B2', public.locacao_fin_baixa(pg_temp.id('C1'), pg_temp.d('m1') + 14, 2396.67, NULL));
SELECT pg_temp.ok((pg_temp.j('B2')->>'multa')::numeric = 40 AND (pg_temp.j('B2')->'regra_encargos'->>'multa_pct')::numeric = 2,
  'nova regra (multa 2%) vale na baixa seguinte: multa 40');
SELECT pg_temp.ok((pg_temp.j('B2')->'repasse_calc'->>'total')::numeric = -130,
  'multa da imobiliária não vai ao proprietário: 2.000 − 2.000 + 50 − 180 = −130 (saldo devedor visível)');
SELECT public.locacao_fin_config_salvar('{"retem_primeiro_aluguel":false}');
SELECT pg_temp.ok((SELECT (x->'repasse_calc'->>'total')::numeric = 1670 FROM jsonb_array_elements(public.locacao_fin_painel(pg_temp.d('m1'))->'cobrancas') x),
  'sem retenção do 1º aluguel: 2.000 − 200 (taxa 10%) + 50 − 180 = 1.670');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_config_salvar(''{"multa_pct":5}'')') LIKE '42501%', 'corretor não altera regras financeiras');
SELECT pg_temp.as_user(pg_temp.id('ffin')::text);

-- 7) Mês atual, cancelamento e painel --------------------------------------------------------------------------------
SELECT pg_temp.put('B0', public.locacao_fin_baixa(pg_temp.id('C0'), least(pg_temp.d('hoje'), pg_temp.d('m0') + 4), 2350, NULL));
SELECT pg_temp.ok((pg_temp.j('B0')->>'multa')::numeric = 0 AND (pg_temp.j('B0')->'repasse_calc'->>'total')::numeric = 1850,
  'pago em dia: sem encargos; repasse 2.000 − 200 + 50 = 1.850');
SELECT public.locacao_fin_repasse_feito(pg_temp.id('C0'), pg_temp.d('hoje'), NULL);
SELECT pg_temp.ok((public.locacao_fin_gerar_cobrancas(pg_temp.d('mp'))->>'geradas')::int = 1, 'gera o próximo mês');
RESET ROLE;
SELECT pg_temp.setid('CP', (pg_temp.cob(pg_temp.id('CT'), pg_temp.d('mp'))).id);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ffin')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_cancelar(%L, '''')', pg_temp.id('CP'))) LIKE '22023%motivo%',
  'cancelar exige motivo');
SELECT pg_temp.ok(public.locacao_fin_cancelar(pg_temp.id('CP'), 'Gerada por engano (teste)')->>'status' = 'cancelada', 'cobrança cancelada com motivo');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_baixa(%L, %L, 2350, NULL)', pg_temp.id('CP'), pg_temp.d('hoje'))) LIKE '22023%',
  'cobrança cancelada não recebe baixa');
SELECT pg_temp.put('P', public.locacao_fin_painel(pg_temp.d('m0')));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('P')->'cobrancas') = 1 AND (pg_temp.j('P')->>'faltam_gerar')::int = 0
  AND jsonb_array_length(pg_temp.j('P')->'contratos') = 2
  AND (SELECT (x->'repasse'->>'valor')::numeric = 1850 FROM jsonb_array_elements(pg_temp.j('P')->'cobrancas') x),
  'painel do mês: 1 cobrança paga com repasse feito, 2 contratos, nada faltando gerar');

-- 8) Extrato por proprietário e auditoria -------------------------------------------------------------------------------
SELECT pg_temp.put('X', public.locacao_fin_extrato('  helena exemplo (FICTÍCIA) '));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('X')->'cobrancas') = 2 AND jsonb_array_length(pg_temp.j('X')->'contratos') = 1,
  'extrato do proprietário (busca sem diferenciar maiúsculas): 1 contrato, 2 cobranças pagas');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_extrato(''ab'')') LIKE '22023%', 'extrato exige nome válido');
SELECT pg_temp.put('D', public.locacao_fin_contrato(pg_temp.id('CT')));
SELECT pg_temp.ok((SELECT count(DISTINCT x->>'acao') FROM jsonb_array_elements(pg_temp.j('D')->'eventos') x
   WHERE x->>'acao' IN ('contrato_criado', 'contrato_editado', 'contrato_ativado', 'cobranca_gerada', 'baixa', 'desconto', 'repasse',
                        'repasse_desfeito', 'estorno', 'cobranca_cancelada')) = 10,
  'histórico do contrato tem criação, edição, ativação, geração, baixa, desconto, repasse, repasse desfeito, estorno e cancelamento');
SELECT pg_temp.ok((SELECT bool_and(x->>'ator_nome' IS NOT NULL) FROM jsonb_array_elements(pg_temp.j('D')->'eventos') x
   WHERE x->>'acao' IN ('baixa', 'repasse', 'estorno')), 'baixa, repasse e estorno guardam quem fez');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_fin_eventos WHERE acao = 'regras' AND dados ? 'antes' AND dados ? 'depois') = 2,
  'mudança de regra guarda "antes" e "depois"');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.locacao_fin_eventos SET descricao = ''alterado'' WHERE true') LIKE '42501%',
  'histórico financeiro não pode ser alterado nem pelo banco (trigger)');

-- 9) Isolamento e módulo desligado -------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_fin_painel(NULL)->'contratos') = 0, 'isolamento: admin da B não vê contratos da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_contrato(%L)', pg_temp.id('CT'))) LIKE '42501%', 'isolamento: contrato da A negado para B');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_fin_estornar(%L, ''tentativa de B'')', pg_temp.id('C0'))) LIKE '42501%',
  'isolamento: B não mexe em cobrança da A');
SELECT pg_temp.ok(jsonb_array_length(public.locacao_fin_extrato('Helena Exemplo (fictícia)')->'cobrancas') = 0,
  'isolamento: extrato do mesmo nome na B vem vazio');
SELECT pg_temp.ok((public.locacao_fin_painel(NULL)->'config'->>'multa_pct')::numeric = 10, 'regras são por imobiliária: B segue no exemplo');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.locacao_cobrancas') LIKE '42501%', 'tabela direta: permission denied');
RESET ROLE;
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgA') AND module = 'locacao';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('ffin')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_fin_painel(NULL)') LIKE '42501%desligada%', 'módulo desligado: financeiro recusado');
RESET ROLE;

-- Resultado -----------------------------------------------------------------------------------------------------------
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;

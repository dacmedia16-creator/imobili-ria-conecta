-- Suíte da migration 20261217120000 (Locação "Sem administração", t_ec2962bd). Roda DENTRO de transação revertida
-- (run-locacao-sem-administracao.sh), na homologação, só com dados fictícios. Pessoas da homologação (Agência A):
-- c2 = QA A Corretor Dois (corretor), con = QA A Dono Plataforma (contratos + vistoria = Fernanda), b1 = Agência B.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON r, ids TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid = '' THEN '' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.loc(_k text) RETURNS public.locacoes LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT l FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.lan(_k text) RETURNS public.locacao_lancamentos LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT x FROM public.locacao_lancamentos x WHERE x.locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.ncontratos(_k text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT count(*) FROM public.locacao_contratos WHERE locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('con', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true),
  (pg_temp.id('orgB'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('con'), 'contratos'),
  (pg_temp.id('orgA'), pg_temp.id('con'), 'vistoria')
ON CONFLICT DO NOTHING;

-- 0) Estrutura: padrão "com administração" e nada muda nas locações existentes ----------------------------------------
SELECT pg_temp.ok((SELECT bool_and(column_default = 'false' AND is_nullable = 'NO') FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'sem_administracao' AND table_name IN ('locacoes', 'locacao_lancamentos'))
  AND (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'sem_administracao') = 2,
  'coluna sem_administracao nas 2 tabelas, padrão false (com administração)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacoes WHERE sem_administracao OR taxa_adm <= 0)
  AND NOT EXISTS (SELECT 1 FROM public.locacao_lancamentos WHERE sem_administracao OR taxa_adm <= 0),
  'locações e lançamentos existentes continuam com administração e com taxa');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_salvar_pre', 'locacao_lancamento_ler', 'locacao_lancamento_salvar', 'locacao_lista')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR NOT p.prosecdef OR NOT coalesce('search_path=""' = ANY (p.proconfig), false))),
  'RPCs redefinidas: só com login, SECURITY DEFINER e search_path vazio (permissões mantidas)');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_fin_criar_contrato(public.locacoes)', 'EXECUTE'),
  'criação do contrato no Financeiro continua fora do alcance do navegador');

-- 1) Pré-análise: escolha com/sem administração --------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.setid('S', (public.locacao_criar('casa')->>'id')::uuid);
SELECT pg_temp.setid('C', (public.locacao_criar('casa')->>'id')::uuid);
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('S'))->>'sem_administracao')::boolean = false
  AND (public.locacao_detalhe(pg_temp.id('S'))->>'taxa_adm')::numeric = 10, 'nova locação nasce com administração e 10%');
SELECT public.locacao_salvar_pre(pg_temp.id('S'), '{"aluguel": 2000, "sem_administracao": true, "taxa_adm": 10}');
SELECT pg_temp.ok((SELECT sem_administracao AND taxa_adm = 0 FROM pg_temp.loc('S')),
  'sem administração grava taxa 0 explícita (mesmo se o site mandar taxa)');
SELECT public.locacao_salvar_pre(pg_temp.id('S'), '{"aluguel": 2100}');
SELECT pg_temp.ok((SELECT sem_administracao AND taxa_adm = 0 AND aluguel = 2100 FROM pg_temp.loc('S')),
  'salvar sem mandar a escolha mantém "sem administração"');
SELECT public.locacao_salvar_pre(pg_temp.id('S'), '{"sem_administracao": false}');
SELECT pg_temp.ok((SELECT NOT sem_administracao AND taxa_adm = 10 FROM pg_temp.loc('S')),
  'voltar para "com administração" sem taxa informada usa 10%');
SELECT public.locacao_salvar_pre(pg_temp.id('S'), '{"sem_administracao": false, "taxa_adm": 8}');
SELECT pg_temp.ok((SELECT NOT sem_administracao AND taxa_adm = 8 FROM pg_temp.loc('S')), 'com administração: taxa editável (8%)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, ''{"taxa_adm": 0}'')', pg_temp.id('S'))) LIKE '22023%',
  'com administração, taxa 0 continua recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, ''{"taxa_adm": 31}'')', pg_temp.id('S'))) LIKE '22023%',
  'com administração, taxa acima de 30% continua recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_salvar_pre(%L, ''{"sem_administracao": "talvez"}'')', pg_temp.id('S')))
  LIKE '22023%', 'valor inválido na escolha é recusado');
SELECT public.locacao_salvar_pre(pg_temp.id('S'), '{"sem_administracao": true}');
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('S'))->>'sem_administracao')::boolean
  AND (public.locacao_detalhe(pg_temp.id('S'))->>'taxa_adm')::numeric = 0, 'detalhe devolve sem_administracao e taxa 0');
SELECT pg_temp.ok((SELECT (x->>'sem_administracao')::boolean FROM jsonb_array_elements(public.locacao_lista()) x
   WHERE (x->>'id')::uuid = pg_temp.id('S')), 'lista devolve sem_administracao');
SELECT public.locacao_salvar_pre(pg_temp.id('C'), '{"aluguel": 2000}');
RESET ROLE;

-- 2) Banco recusa combinação inconsistente (mesmo por fora das RPCs) -----------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.locacoes SET taxa_adm = 10 WHERE id = %L', pg_temp.id('S'))) LIKE '23514%',
  'sem administração com taxa > 0: recusado pelo CHECK');
SELECT pg_temp.ok(pg_temp.err(format('UPDATE public.locacoes SET taxa_adm = 0 WHERE id = %L', pg_temp.id('C'))) LIKE '23514%',
  'com administração com taxa 0: recusado pelo CHECK');

-- 3) Lançamento da Fernanda -----------------------------------------------------------------------------------------
UPDATE public.locacoes SET etapa = 'pos_assinatura' WHERE id IN (pg_temp.id('S'), pg_temp.id('C'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok((public.locacao_lancamento_ler(pg_temp.id('S'))->'valores'->>'sem_administracao')::boolean
  AND (public.locacao_lancamento_ler(pg_temp.id('S'))->'valores'->>'taxa_adm')::numeric = 0,
  'sugestão do lançamento traz "sem administração" da pré-análise');
SELECT pg_temp.ok(NOT (public.locacao_lancamento_ler(pg_temp.id('C'))->'valores'->>'sem_administracao')::boolean,
  'sugestão do lançamento com administração traz false');
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel": "2000", "sem_administracao": true}')->>'novo')::boolean,
  'lançamento sem administração aceito sem taxa');
SELECT pg_temp.ok((SELECT sem_administracao AND taxa_adm = 0 FROM pg_temp.lan('S'))
  IS TRUE, 'lançamento grava sem administração com taxa 0');
SELECT public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel": "2000", "sem_administracao": "true", "taxa_adm": "9"}');
SELECT pg_temp.ok((public.locacao_lancamento_ler(pg_temp.id('S'))->'valores'->>'taxa_adm')::numeric = 0
  AND (public.locacao_lancamento_ler(pg_temp.id('S'))->'valores'->>'sem_administracao')::boolean,
  'sem administração ignora taxa enviada (fica 0) e aceita "true" em texto');
SELECT pg_temp.ok((SELECT x->'lancamento'->>'sem_administracao' FROM jsonb_array_elements(public.locacao_lista()) x
   WHERE (x->>'id')::uuid = pg_temp.id('S')) = 'true', 'lista leva sem_administracao do lançamento (aba Comissão)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel": "2000", "sem_administracao": false}'')',
  pg_temp.id('C'))) LIKE '22023%taxa%', 'com administração continua exigindo a taxa');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel": "2000", "taxa_adm": "40"}'')',
  pg_temp.id('C'))) LIKE '22023%taxa%', 'com administração, taxa acima de 30% recusada');
SELECT public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel": "2000", "taxa_adm": "10"}');
SELECT pg_temp.ok((SELECT sem_administracao AND taxa_adm = 0 FROM pg_temp.lan('S')) IS TRUE
  AND (SELECT sem_administracao FROM pg_temp.loc('S')),
  'pedido sem a escolha (aba com o site antigo) mantém "sem administração"');
SELECT pg_temp.ok(NOT (public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel": "2000", "taxa_adm": "9", "sem_administracao": false}')->>'novo')::boolean
  AND (SELECT NOT sem_administracao AND taxa_adm = 9 FROM pg_temp.lan('S')) IS TRUE
  AND (SELECT NOT sem_administracao AND taxa_adm = 9 FROM pg_temp.loc('S')),
  'Fernanda corrige para com administração antes da chave: locação acompanha (mesma taxa)');
SELECT public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel": "2000", "sem_administracao": true}');
SELECT pg_temp.ok((SELECT sem_administracao AND taxa_adm = 0 FROM pg_temp.loc('S')),
  'Fernanda volta para sem administração: locação acompanha (taxa 0)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel": "2000", "sem_administracao": true, "locador": true}'')',
  pg_temp.id('C'))) LIKE '22023%Campos%', 'verdadeiro/falso só é aceito no campo sem_administracao');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel": "2000", "sem_administracao": true}'')',
  pg_temp.id('S'))) LIKE '42501%', 'corretor continua sem lançar');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_ler(%L)', pg_temp.id('S'))) LIKE '42501%',
  'outra imobiliária não vê');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_eventos WHERE locacao_id = pg_temp.id('S')
   AND descricao LIKE '%sem administração (intermediação: 1 aluguel)%') >= 1, 'histórico registra "sem administração"');

-- 3b) Junção com o PR #371 (t_1574da63): sem administração + parceria mantém lado/CRECI e parceiro = aluguel ÷ 2 ----------
INSERT INTO ids VALUES ('fin', '5745cbff-22b6-4a28-a515-dd6706504b8b');
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('fin'), 'financeiro')
ON CONFLICT DO NOTHING;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, %L)', pg_temp.id('S'),
  '{"aluguel":"2000","sem_administracao":true,"parceria":"externa","parceria_imobiliaria":"Imob Parceira (fictícia)"}')) LIKE '22023%lado%',
  'sem administração com parceria continua exigindo o lado do parceiro (#371)');
SELECT public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel":"2000","sem_administracao":true,"parceria":"externa",
  "parceria_imobiliaria":"Imob Parceira (fictícia)","parceria_corretor":"Corretor Parceiro (fictício)","parceria_lado":"locatario","parceria_creci":"1-F"}');
SELECT pg_temp.ok((SELECT sem_administracao AND taxa_adm = 0 AND parceria_lado = 'locatario' AND parceria_creci = '1-F' FROM pg_temp.lan('S')) IS TRUE
  AND public.locacao_lancamento_ler(pg_temp.id('S'))->'valores'->>'parceria_lado' = 'locatario'
  AND (public.locacao_lancamento_ler(pg_temp.id('S'))->'valores'->>'sem_administracao')::boolean,
  'lançamento sem administração grava e lê lado/CRECI do parceiro');
SELECT pg_temp.as_user(pg_temp.id('fin')::text);
SELECT pg_temp.ok((SELECT (i->>'valor_parceiro')::numeric FROM jsonb_array_elements(public.locacao_parceiros_pagar()->'itens') i
   WHERE (i->>'id')::uuid = pg_temp.id('S')) = 1000, 'sem administração: parceiro recebe aluguel ÷ 2 (R$ 1.000 de R$ 2.000)');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel":"2000","sem_administracao":true}');
RESET ROLE;

-- 4) Financeiro: sem administração não gera contrato (cobrança/repasse/taxa) -------------------------------------------
SELECT pg_temp.as_user('');
UPDATE public.locacoes SET etapa = 'chaves', chave_em = (now() AT TIME ZONE 'America/Sao_Paulo')::date
 WHERE id IN (pg_temp.id('S'), pg_temp.id('C'));
SELECT pg_temp.ok(pg_temp.ncontratos('S') = 0, 'chave entregue sem administração: nenhum contrato no Financeiro');
SELECT pg_temp.ok(pg_temp.ncontratos('C') = 1, 'chave entregue com administração: contrato criado como antes');
SELECT pg_temp.ok((SELECT taxa_adm = 10 FROM public.locacao_contratos WHERE locacao_id = pg_temp.id('C')), 'contrato com a taxa da locação');
SELECT pg_temp.ok(public.locacao_fin_criar_contrato(pg_temp.loc('S')) IS NULL AND pg_temp.ncontratos('S') = 0,
  'chamada direta também não cria contrato sem administração');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel": "2000", "sem_administracao": true}'')',
  pg_temp.id('C'))) LIKE '22023%Chaves já entregues%', 'depois da chave, trocar com → sem pelo lançamento é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel": "2000", "taxa_adm": "10", "sem_administracao": false}'')',
  pg_temp.id('S'))) LIKE '22023%Chaves já entregues%', 'depois da chave, trocar sem → com pelo lançamento é recusado');
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('S'), '{"aluguel": "2100", "sem_administracao": true}')->>'ok')::boolean,
  'depois da chave, corrigir outros valores mantendo a escolha continua permitido');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.ncontratos('S') = 0 AND (SELECT sem_administracao FROM pg_temp.loc('S'))
  AND (SELECT NOT sem_administracao FROM pg_temp.loc('C')), 'locação e Financeiro continuam coerentes');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_eventos WHERE locacao_id = pg_temp.id('S')
   AND descricao = 'Marcada sem administração (intermediação: 1 aluguel)') >= 1
  AND (SELECT count(*) FROM public.locacao_eventos WHERE locacao_id = pg_temp.id('S')
   AND descricao LIKE 'Marcada com administração (taxa 10%)') >= 1, 'pré-análise registra a troca com/sem no histórico');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;

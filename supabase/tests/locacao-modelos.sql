-- Suíte da migration 20261201120000 (modelos de contrato por garantia + apólice que trava a entrega das chaves;
-- t_d08cfeee). Roda DENTRO de transação revertida (run-locacao-modelos.sh), DEPOIS de locacao-minuta-seed.sql: a locação
-- L (Agência A, seguro-fiança residencial) está na etapa Minuta com documentos completos. Só dados fictícios.
-- Pessoas (homologação): c2 = corretor dono, a1 = outro corretor da A, ges = gestora, con = setor de contratos,
-- adm = administrador da A, b1/admB = pessoas da imobiliária B.
RESET ROLE;
CREATE TEMP TABLE mp(k text PRIMARY KEY, path text);
GRANT ALL ON mp TO authenticated, service_role;
CREATE FUNCTION pg_temp.arquivo(_k text, _path text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO mp VALUES (_k, _path) ON CONFLICT (k) DO UPDATE SET path = EXCLUDED.path;
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('locacao-documentos', _path, NULL,
    jsonb_build_object('mimetype', CASE WHEN _path LIKE '%.pdf' THEN 'application/pdf' ELSE 'image/jpeg' END));
  SELECT _path $$;
CREATE FUNCTION pg_temp.p(_k text) RETURNS text LANGUAGE sql AS $$ SELECT path FROM mp WHERE k = _k $$;
CREATE FUNCTION pg_temp.ev(_l uuid, _like text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.locacao_eventos WHERE locacao_id = _l AND descricao LIKE _like) $$;
-- Índice (base 0) do 1º parágrafo travado / do 1º parágrafo comum de texto.
CREATE FUNCTION pg_temp.i_trava(_p jsonb) RETURNS int LANGUAGE sql AS $$
  SELECT (n - 1)::int FROM jsonb_array_elements(_p) WITH ORDINALITY x(e, n) WHERE e->>'trava' = 'true' ORDER BY n LIMIT 1 $$;
CREATE FUNCTION pg_temp.i_comum(_p jsonb) RETURNS int LANGUAGE sql AS $$
  SELECT (n - 1)::int FROM jsonb_array_elements(_p) WITH ORDINALITY x(e, n)
   WHERE e->>'trava' IS NULL AND e->>'t' LIKE 'Cláusula%' ORDER BY n LIMIT 1 $$;
CREATE FUNCTION pg_temp.anexo_id(_path text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT id FROM public.locacao_anexos WHERE storage_path = _path $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;
-- Locação F (fiador, mesma imobiliária) e T (título de capitalização) só para comparar.
INSERT INTO ids SELECT k, gen_random_uuid() FROM unnest(ARRAY['F', 'T']) k;
INSERT INTO public.locacoes (id, organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, minuta, candidato)
SELECT pg_temp.id(k), pg_temp.id('orgA'), pg_temp.id('c2'), 'minuta', 'Rua Fictícia dos Ipês, 45 — Sorocaba/SP', 1900,
       g, 'residencial', '{"estado":"elaborando","externa":false}', '{"nome":"Locatário Exemplo (fictício)"}'
  FROM (VALUES ('F', 'fiador'), ('T', 'titulo_capitalizacao')) v(k, g);
INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo)
SELECT pg_temp.id('orgA'), l.id, x, 'modelos-teste/' || l.id || '/' || md5(x) || '.pdf', 'doc-ficticio.pdf'
  FROM public.locacoes l, unnest(public.locacao_checklist_l(l)) x WHERE l.id IN (pg_temp.id('F'), pg_temp.id('T'));
SELECT public.locacao_docs_situacao(v) FROM ids WHERE k IN ('F', 'T');

-- 0) Estrutura, permissões e padrão do sistema ---------------------------------------------------------------------
SELECT pg_temp.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.locacao_modelos'::regclass,
    'public.locacao_anexos'::regclass))
  AND NOT has_table_privilege('authenticated', 'public.locacao_modelos', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.locacao_anexos', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.locacao_modelos', 'SELECT'), 'tabelas novas com RLS e fechadas ao navegador');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_modelo_gravar', 'locacao_modelo_validar', 'locacao_modelo_atual', 'locacao_tem_apolice',
                     'locacao_anexo_exige', 'locacao_modelo_exige')
   AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'funções internas não são chamáveis pelo navegador');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_modelos_listar', 'locacao_modelo_ler', 'locacao_modelo_historico', 'locacao_modelo_salvar',
                     'locacao_modelo_restaurar', 'locacao_anexo_preparar', 'locacao_anexo_registrar', 'locacao_anexo_ver',
                     'locacao_minuta_registrar')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR NOT p.prosecdef OR NOT coalesce('search_path=""' = ANY (p.proconfig), false))),
  'RPCs novas: só com login, SECURITY DEFINER e search_path vazio');
SELECT pg_temp.ok((SELECT count(DISTINCT chave) FROM public.locacao_modelos WHERE organization_id IS NULL) = 8,
  'padrão do sistema: 8 modelos (fiador, caução, caucionamento, Porto, Pottencial, Tokio, Almada, Loft)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacao_modelos m, jsonb_array_elements(m.paragrafos) e
   WHERE m.organization_id IS NULL AND e->>'t' ~ '[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}'),
  'padrão do sistema sem nenhum CPF');
SELECT pg_temp.ok((SELECT bool_and(public.locacao_modelo_validar(m.chave, m.paragrafos) = m.paragrafos)
    FROM public.locacao_modelos m WHERE m.organization_id IS NULL), 'os 8 textos-base passam na validação do editor');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_modelos m, jsonb_array_elements(m.paragrafos) e
   WHERE m.organization_id IS NULL AND m.chave LIKE 'seguro%' AND e->>'trava' = 'true') > 30
  AND (SELECT count(*) FROM public.locacao_modelos m, jsonb_array_elements(m.paragrafos) e
   WHERE m.organization_id IS NULL AND m.chave IN ('fiador', 'caucao_dinheiro', 'caucao_imovel') AND e->>'trava' = 'true') = 0,
  'cláusulas de seguradora/Loft marcadas como travadas; fiador e caução não');

-- 1) Quem vê e edita os modelos -------------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_modelos_listar()') LIKE '42501%', 'corretor não abre os modelos');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_modelo_ler(''fiador'')') LIKE '42501%', 'corretor não lê o texto do modelo');
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_modelos_listar()') LIKE '42501%', 'gestora não abre os modelos');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_modelos_listar()) = 8
  AND (SELECT bool_and((x->>'padrao')::boolean AND (x->>'versao')::int = 0) FROM jsonb_array_elements(public.locacao_modelos_listar()) x),
  'setor de contratos vê os 8 modelos, todos ainda no padrão do sistema');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(jsonb_array_length(public.locacao_modelos_listar()) = 8, 'administrador da imobiliária vê os modelos');

-- 2) Editar = versão nova com data e autor; cada imobiliária tem a sua cópia ----------------------------------------
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.put('fia0', public.locacao_modelo_ler('fiador')->'paragrafos');
SELECT pg_temp.put('fia1', jsonb_set(pg_temp.j('fia0'), ARRAY[pg_temp.i_comum(pg_temp.j('fia0'))::text, 't'],
  to_jsonb((pg_temp.j('fia0')->pg_temp.i_comum(pg_temp.j('fia0'))->>'t') || ' Texto acrescentado no teste.')));
SELECT pg_temp.put('r1', public.locacao_modelo_salvar('fiador', pg_temp.j('fia1'), 'ajuste de teste'));
SELECT pg_temp.ok((pg_temp.j('r1')->>'versao')::int = 1 AND NOT (pg_temp.j('r1')->>'padrao')::boolean
  AND pg_temp.j('r1')->>'autor' IS NOT NULL AND pg_temp.j('r1')->>'criado_em' IS NOT NULL, 'salvar gera a v1 com data e autor');
SELECT pg_temp.ok(public.locacao_modelo_ler('fiador')->'paragrafos' = pg_temp.j('fia1')
  AND (public.locacao_modelo_ler('fiador', 0)->'paragrafos') = pg_temp.j('fia0'), 'vigente = v1; padrão do sistema intacto');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_modelo_salvar(''fiador'', %L::jsonb)', pg_temp.j('fia1')))
  LIKE '22023%Nada mudou%', 'salvar sem mudança é recusado');
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok((public.locacao_modelo_ler('fiador')->>'versao')::int = 0
  AND public.locacao_modelo_ler('fiador')->'paragrafos' = pg_temp.j('fia0'), 'outra imobiliária continua no padrão (cópias separadas)');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_modelo_ler(''fiador'', 1)') LIKE '22023%não encontrad%',
  'outra imobiliária não lê a versão da A');

-- 3) Editor: campo que não existe, bloco automático e estrutura ----------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_modelo_salvar(''fiador'', %L::jsonb)',
    pg_temp.j('fia1') || '[{"id":"novo1","t":"Cláusula nova com [CAMPO_QUE_NAO_EXISTE]."}]'::jsonb))
  LIKE '22023%Campo que não existe: [CAMPO_QUE_NAO_EXISTE]%', 'campo [ ] inexistente é recusado antes de salvar');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_modelo_salvar(''fiador'', %L::jsonb)',
    (SELECT jsonb_agg(e ORDER BY n) FROM jsonb_array_elements(pg_temp.j('fia1')) WITH ORDINALITY x(e, n) WHERE e->>'t' <> '[[LOCADOR]]')))
  LIKE '22023%Falta o bloco automático [[LOCADOR]]%', 'sem o bloco [[LOCADOR]] não salva');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_modelo_salvar(''fiador'', %L::jsonb)',
    pg_temp.j('fia1') || '[{"id":"novo2","t":"[[INVENTADO]]"}]'::jsonb)) LIKE '22023%Bloco automático desconhecido%',
  'bloco automático inventado é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_modelo_salvar(''fiador'', %L::jsonb)',
    pg_temp.j('fia1') || '[{"id":"novo3","t":"Nova cláusula: o LOCATÁRIO pagará R$ [VALOR_ALUGUEL] no dia [DIA_VENCIMENTO]."}]'::jsonb))
  IS NULL, 'incluir cláusula com campos válidos funciona (v2)');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_modelo_salvar(''fiador'', ''[]''::jsonb)') LIKE '22023%',
  'lista vazia é recusada');

-- 4) Texto exigido pela seguradora: só com confirmação ---------------------------------------------------------------
SELECT pg_temp.put('por0', public.locacao_modelo_ler('seguro_porto')->'paragrafos');
SELECT pg_temp.put('por1', jsonb_set(pg_temp.j('por0'), ARRAY[pg_temp.i_trava(pg_temp.j('por0'))::text, 't'],
  to_jsonb((pg_temp.j('por0')->pg_temp.i_trava(pg_temp.j('por0'))->>'t') || ' (texto atualizado pela seguradora)')));
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_modelo_salvar(''seguro_porto'', %L::jsonb)', pg_temp.j('por1')))
  LIKE '22023%exigido pela seguradora%confirme%', 'mudar cláusula da seguradora sem confirmar: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_modelo_salvar(''seguro_porto'', %L::jsonb, NULL, false)',
    (SELECT jsonb_agg(CASE WHEN n - 1 = pg_temp.i_trava(pg_temp.j('por0')) THEN e - 'trava' ELSE e END ORDER BY n)
       FROM jsonb_array_elements(pg_temp.j('por0')) WITH ORDINALITY x(e, n)))) LIKE '22023%exigido pela seguradora%',
  'tirar a marca de "exigido pela seguradora" também pede confirmação');
SELECT pg_temp.ok((public.locacao_modelo_salvar('seguro_porto', pg_temp.j('por1'), 'Porto atualizou', true)->>'versao')::int = 1,
  'com confirmação explícita, salva a v1 da Porto');
SELECT pg_temp.put('por2', jsonb_set(pg_temp.j('por1'), ARRAY[pg_temp.i_comum(pg_temp.j('por1'))::text, 't'],
  to_jsonb((pg_temp.j('por1')->pg_temp.i_comum(pg_temp.j('por1'))->>'t') || ' Ajuste comum.')));
SELECT pg_temp.ok((public.locacao_modelo_salvar('seguro_porto', pg_temp.j('por2'))->>'versao')::int = 2,
  'mudar só cláusula comum (fora do bloco da seguradora) não pede confirmação');

-- 5) Histórico e voltar a uma versão anterior (vira versão nova) ----------------------------------------------------
SELECT pg_temp.ok(jsonb_array_length(public.locacao_modelo_historico('fiador')) = 3
  AND (public.locacao_modelo_historico('fiador')->0->>'versao')::int = 2
  AND (public.locacao_modelo_historico('fiador')->2->>'padrao')::boolean, 'histórico: v2, v1 e o padrão do sistema');
SELECT pg_temp.ok((public.locacao_modelo_restaurar('fiador', 0)->>'versao')::int = 3
  AND public.locacao_modelo_ler('fiador')->'paragrafos' = pg_temp.j('fia0')
  AND public.locacao_modelo_historico('fiador')->0->>'restaurada_de' = '0', 'restaurar o padrão grava a v3 com o texto padrão');
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_modelo_restaurar(''seguro_porto'', 0)') LIKE '22023%exigido pela seguradora%',
  'restaurar texto de seguradora também pede confirmação');
SELECT pg_temp.ok((public.locacao_modelo_restaurar('seguro_porto', 1, true)->>'versao')::int = 3
  AND public.locacao_modelo_ler('seguro_porto')->'paragrafos' = pg_temp.j('por1'), 'restaurar a v1 (com confirmação) grava a v3');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_modelo_salvar(''fiador'', ''[]''::jsonb)') LIKE '42501%'
  AND pg_temp.err('SELECT public.locacao_modelo_restaurar(''fiador'', 0)') LIKE '42501%', 'corretor não edita nem restaura');

-- 6) Montar contrato liberado para as garantias com modelo ----------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.put('mL', public.locacao_montagem_ler(pg_temp.id('L')));
SELECT pg_temp.ok((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.j('mL')->'modelos') k)
    = ARRAY['seguro_almada', 'seguro_porto', 'seguro_pottencial', 'seguro_tokio'],
  'seguro-fiança: a montagem abre e oferece os 4 modelos de seguradora');
SELECT pg_temp.ok((pg_temp.j('mL')->'modelos'->'seguro_porto'->>'versao')::int = 3
  AND (pg_temp.j('mL')->'modelos'->'seguro_tokio'->>'versao')::int = 0, 'montagem usa a versão vigente da imobiliária');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_ler(%L)', pg_temp.id('T'))) LIKE '22023%Ainda não há modelo%',
  'título de capitalização continua sem modelo (segue a minuta anexada)');
SELECT pg_temp.ok((SELECT array_agg(k) FROM jsonb_object_keys(public.locacao_montagem_ler(pg_temp.id('F'))->'modelos') k) = ARRAY['fiador'],
  'fiador continua com o modelo de fiador');
SELECT pg_temp.ok(public.locacao_montagem_salvar(pg_temp.id('L'), '{"d_seg_seguradora":"porto","d_seg_apolice":"AP-TESTE-1"}')->>'ok' = 'true',
  'montagem grava seguradora e apólice nos dados do contrato');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_montagem_salvar(%L, ''{"d_seg_seguradora":"seguradora-x"}'')', pg_temp.id('L')))
  LIKE '22023%', 'seguradora fora da lista é recusada');
RESET ROLE; -- função interna (fechada ao navegador): confere como dono do banco
SELECT pg_temp.ok(NOT public.locacao_contrato_valor_ok('cau_meses', '13') AND public.locacao_contrato_valor_ok('cau_meses', '3')
  AND NOT public.locacao_contrato_valor_ok('cau_valor', '-1') AND public.locacao_contrato_valor_ok('cau_tipo', 'imovel'),
  'validação dos campos de caução');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);

-- 7) Minuta gerada guarda modelo e versão; recusa modelo errado ou desatualizado -----------------------------------
SELECT pg_temp.arquivo('g1', public.locacao_minuta_preparar(pg_temp.id('L'), 'pdf')->>'path');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_registrar(%L, %L, ''c.pdf'', ''gerada'', ''fiador'', 0)',
    pg_temp.id('L'), pg_temp.p('g1'))) LIKE '22023%não tem modelo%', 'modelo de fiador numa locação com seguro: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_registrar(%L, %L, ''c.pdf'', ''gerada'', ''seguro_porto'', 2)',
    pg_temp.id('L'), pg_temp.p('g1'))) LIKE '22023%modelo de contrato mudou%', 'versão de texto desatualizada: recusado');
SELECT pg_temp.ok((public.locacao_minuta_registrar(pg_temp.id('L'), pg_temp.p('g1'), 'contrato-porto.pdf', 'gerada',
    'seguro_porto', 3)->>'versao')::int = 1, 'minuta gerada pelo modelo Porto (texto v3) guardada como v1');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minutas'->0->>'modelo_chave' = 'seguro_porto'
  AND (public.locacao_detalhe(pg_temp.id('L'))->'minutas'->0->>'modelo_versao')::int = 3
  AND pg_temp.ev(pg_temp.id('L'), 'Minuta v1 gerada pelo modelo "Seguro-fiança Porto Seguro" (texto v3)%'),
  'cada minuta guarda a versão de texto que usou (e o histórico diz qual)');
SELECT public.locacao_modelo_salvar('seguro_porto', pg_temp.j('por2'));
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('L'))->'minutas'->0->>'modelo_versao')::int = 3,
  'editar o modelo depois não muda a minuta já gerada');
SELECT pg_temp.arquivo('a1', public.locacao_minuta_preparar(pg_temp.id('L'), 'pdf')->>'path');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_registrar(%L, %L, ''a.pdf'', ''anexo'', ''seguro_porto'', 0)',
    pg_temp.id('L'), pg_temp.p('a1'))) LIKE '22023%Origem inválida%', 'anexo manual não aceita modelo/versão');
SELECT pg_temp.ok((public.locacao_minuta_registrar(pg_temp.id('L'), pg_temp.p('a1'), 'a.pdf', 'anexo')->>'versao')::int = 2,
  'anexo manual continua funcionando (chamada antiga, 4 parâmetros)');

-- 8) Apólice: anexável antes/depois da assinatura; sem ela a entrega das chaves é recusada --------------------------
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('L'))->>'apolice_pendente')::boolean
  AND NOT (public.locacao_detalhe(pg_temp.id('F'))->>'apolice_pendente')::boolean, 'seguro-fiança sem apólice: pendência visível');
RESET ROLE;
UPDATE public.locacoes SET etapa = 'chaves', etapa_desde = now() WHERE id IN (pg_temp.id('L'), pg_temp.id('F'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pos_acao(%L, ''entregar_chaves'')', pg_temp.id('L')))
  LIKE '22023%Apólice pendente — anexe para liberar a entrega de chaves%', 'TRAVA: seguro-fiança sem apólice não entrega a chave');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'chaves' AND public.locacao_detalhe(pg_temp.id('L'))->>'chave_em' IS NULL,
  'recusado: nada muda');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pos_acao(%L, ''entregar_chaves'')', pg_temp.id('F'))) IS NULL,
  'fiador não tem apólice: entrega das chaves segue como antes');
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_anexo_preparar(%L, ''apolice'', ''pdf'')', pg_temp.id('L'))) LIKE '42501%',
  'gestora (sem papel de contratos/vistoria) não anexa apólice');
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_anexo_preparar(%L, ''apolice'', ''pdf'')', pg_temp.id('L'))) LIKE '42501%',
  'outra imobiliária não anexa');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_anexo_preparar(%L, ''loft_termos'', ''pdf'')', pg_temp.id('L')))
  LIKE '22023%não se aplica%', 'termos da Loft não se aplicam ao seguro-fiança');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_anexo_preparar(%L, ''apolice'', ''exe'')', pg_temp.id('L')))
  LIKE '22023%PDF ou imagem%', 'apólice só em PDF ou imagem');
SELECT pg_temp.arquivo('ap1', public.locacao_anexo_preparar(pg_temp.id('L'), 'apolice', 'pdf')->>'path');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_anexo_registrar(%L, ''apolice'', %L, ''x.pdf'')', pg_temp.id('L'),
    pg_temp.id('L')::text || '/anexos/x.pdf')) LIKE '22023%não encontrado%', 'caminho forjado é recusado');
SELECT pg_temp.ok(public.locacao_anexo_registrar(pg_temp.id('L'), 'apolice', pg_temp.p('ap1'), 'apolice-ficticia.pdf', 'AP-TESTE-1')->>'id' IS NOT NULL,
  'corretor anexa a apólice (com número) depois da assinatura');
SELECT pg_temp.ok(NOT (public.locacao_detalhe(pg_temp.id('L'))->>'apolice_pendente')::boolean
  AND public.locacao_detalhe(pg_temp.id('L'))->'anexos'->0->>'numero' = 'AP-TESTE-1'
  AND pg_temp.ev(pg_temp.id('L'), 'Apólice anexada — nº AP-TESTE-1%'), 'pendência some; anexo e histórico registrados');
SELECT pg_temp.ok(public.locacao_anexo_ver((public.locacao_detalhe(pg_temp.id('L'))->'anexos'->0->>'id')::uuid)->>'path' = pg_temp.p('ap1'),
  'quem vê a locação baixa a apólice');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_anexo_ver(%L)', pg_temp.anexo_id(pg_temp.p('ap1')))) LIKE '42501%',
  'outra imobiliária não baixa');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_pos_acao(%L, ''entregar_chaves'')', pg_temp.id('L'))) IS NULL
  AND public.locacao_detalhe(pg_temp.id('L'))->>'chave_em' IS NOT NULL, 'com a apólice anexada, a chave é entregue');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;

-- Suíte da migration 20261130120000 (minuta anexada e versionada, trava do envio, andamentos, pagamento 8/23;
-- t_f8f83f9f). Roda DENTRO de transação revertida (run-locacao-minuta.sh), DEPOIS do preparo fictício de
-- locacao-ficha.sql (linhas 1–207): a locação L está na etapa Minuta, com documentos completos e minuta "elaborando".
-- Pessoas (homologação): c2 = corretor dono, a1 = outro corretor da A, ges = gestora, con = setor de contratos,
-- adm = administrador da A, b1/admB = pessoas da imobiliária B.
RESET ROLE; -- ajudantes abaixo pertencem ao dono do banco (gravam o arquivo fictício em storage.objects)
CREATE TEMP TABLE mp(k text PRIMARY KEY, path text);
GRANT ALL ON mp TO authenticated, service_role;
CREATE FUNCTION pg_temp.arquivo(_k text, _path text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO mp VALUES (_k, _path) ON CONFLICT (k) DO UPDATE SET path = EXCLUDED.path;
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('locacao-documentos', _path, NULL,
    jsonb_build_object('mimetype', CASE WHEN _path LIKE '%.pdf' THEN 'application/pdf'
      WHEN _path LIKE '%.doc' THEN 'application/msword' ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' END));
  SELECT _path $$;
CREATE FUNCTION pg_temp.arquivo_falso(_k text, _path text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO mp VALUES (_k, _path) ON CONFLICT (k) DO UPDATE SET path = EXCLUDED.path;
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('locacao-documentos', _path, NULL,
    '{"mimetype":"text/html"}'::jsonb);
  SELECT _path $$;
CREATE FUNCTION pg_temp.p(_k text) RETURNS text LANGUAGE sql AS $$ SELECT path FROM mp WHERE k = _k $$;
CREATE FUNCTION pg_temp.ev(_l uuid, _like text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.locacao_eventos WHERE locacao_id = _l AND descricao LIKE _like) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;
RESET ROLE;

-- 0) Estrutura e permissões ----------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.locacao_minutas'::regclass,
    'public.locacao_andamentos'::regclass))
  AND NOT has_table_privilege('authenticated', 'public.locacao_minutas', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.locacao_andamentos', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.locacao_minutas', 'SELECT'), 'tabelas novas com RLS e fechadas ao navegador');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.locacao_minuta_atual(uuid)', 'EXECUTE'),
  'função interna da versão atual não é chamável pelo navegador');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_minuta_preparar', 'locacao_minuta_registrar', 'locacao_minuta_ver',
                     'locacao_andamento_registrar', 'locacao_andamento_resolver')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR NOT p.prosecdef OR NOT coalesce('search_path=""' = ANY (p.proconfig), false))),
  'RPCs novas: só com login, SECURITY DEFINER e search_path vazio');
SELECT pg_temp.ok((SELECT public = false AND allowed_mime_types @> ARRAY['application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] FROM storage.buckets WHERE id = 'locacao-documentos'),
  'bucket continua privado e passa a aceitar Word');

-- 1) Pagamento 8/23 sem gravar em locacao_config --------------------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacao_config WHERE organization_id = pg_temp.id('orgB'))
  AND (public.locacao_cfg(pg_temp.id('orgB'))).dia_pagamento_1a15 = 8
  AND (public.locacao_cfg(pg_temp.id('orgB'))).dia_pagamento_16a31 = 23, 'sem regra salva: pagamento dia 8 (1–15) e 23 (16–31)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacao_config WHERE organization_id = pg_temp.id('orgB')),
  'ler a regra não grava linha em locacao_config');
INSERT INTO public.locacao_config (organization_id, dia_pagamento_16a31) VALUES (pg_temp.id('orgA'), 6)
  ON CONFLICT (organization_id) DO UPDATE SET dia_pagamento_16a31 = 6;
SELECT pg_temp.ok((public.locacao_cfg(pg_temp.id('orgA'))).dia_pagamento_16a31 = 6,
  'imobiliária com valor próprio salvo continua com o dela');
SELECT pg_temp.ok((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public'
   AND table_name = 'locacao_config' AND column_name = 'dia_pagamento_16a31') = '23', 'padrão da coluna = 23');

-- 2) Trava: sem arquivo não envia nem prepara assinatura ------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''enviar_minuta'')', pg_temp.id('L')))
  LIKE '22023%Envio travado: anexe a minuta%', 'TRAVA: sem arquivo de minuta, "enviar ao corretor" é recusado no banco');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'estado' = 'elaborando'
  AND NOT pg_temp.ev(pg_temp.id('L'), 'Minuta%enviada ao corretor%'), 'recusado: nada muda e o histórico não diz "enviada"');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'minuta_externa', '{"externa":true}');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''preparar_assinatura'')', pg_temp.id('L')))
  LIKE '22023%Assinatura travada%outra RE/MAX%', 'TRAVA: atalho "outra RE/MAX" também exige o arquivo');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'minuta_externa', '{"externa":false}');

-- 3) Quem pode anexar ---------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_preparar(%L, ''pdf'')', pg_temp.id('L'))) LIKE '42501%',
  'corretor não anexa minuta');
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_preparar(%L, ''pdf'')', pg_temp.id('L'))) LIKE '42501%',
  'gestora não anexa minuta (é do setor de contratos)');
SELECT pg_temp.as_user(pg_temp.id('admB')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_preparar(%L, ''pdf'')', pg_temp.id('L'))) LIKE '42501%',
  'admin de outra imobiliária não anexa');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_preparar(%L, ''exe'')', pg_temp.id('L'))) LIKE '22023%PDF ou Word%',
  'só PDF ou Word');
SELECT pg_temp.ok(public.locacao_minuta_preparar(pg_temp.id('L'), 'docx')->>'path'
  ~ ('^' || pg_temp.id('orgA') || '/' || pg_temp.id('L') || '/minutas/[0-9a-f-]{36}[.]docx$'), 'caminho na pasta da própria locação');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_registrar(%L, %L, ''m.docx'', ''anexo'')', pg_temp.id('L'),
  public.locacao_minuta_preparar(pg_temp.id('L'), 'docx')->>'path')) LIKE '22023%não encontrado%', 'sem upload real o registro é recusado');

-- 4) v1 (Word anexado por fora) → envio ao corretor -----------------------------------------------------------------
SELECT pg_temp.arquivo('v1', public.locacao_minuta_preparar(pg_temp.id('L'), 'docx')->>'path');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_registrar(%L, %L, ''m.docx'', ''gerada'')', pg_temp.id('L'),
  pg_temp.p('v1'))) LIKE '22023%residencial com fiador%', '"Gerar e guardar" recusado fora do modelo (seguro-fiança, Word)');
SELECT pg_temp.arquivo_falso('falso', public.locacao_minuta_preparar(pg_temp.id('L'), 'pdf')->>'path');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_registrar(%L, %L, ''m.pdf'', ''anexo'')', pg_temp.id('L'),
  pg_temp.p('falso'))) LIKE '22023%tipo do arquivo%', 'arquivo com tipo real diferente da extensão é recusado');
SELECT pg_temp.ok((public.locacao_minuta_registrar(pg_temp.id('L'), pg_temp.p('v1'), 'Minuta seguro-fiança (fictícia).docx', 'anexo')->>'versao')::int = 1,
  'anexo vira a versão v1');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_registrar(%L, %L, ''x.docx'', ''anexo'')', pg_temp.id('L'),
  pg_temp.p('v1'))) LIKE '22023%já registrado%', 'o mesmo arquivo não vira duas versões');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_registrar(%L, %L, ''x.pdf'', ''anexo'')', pg_temp.id('P'),
  pg_temp.p('v1'))) IS NOT NULL, 'arquivo de uma locação não é registrado em outra');
SELECT pg_temp.ok(pg_temp.ev(pg_temp.id('L'), 'Minuta v1 anexada (Minuta seguro-fiança (fictícia).docx)'),
  'histórico: data, responsável e nome do arquivo da v1');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'enviar_minuta');
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->'minuta'->>'estado' = 'com_corretor' AND (pg_temp.j('det')->'minuta'->>'versao_enviada')::int = 1
  AND pg_temp.ev(pg_temp.id('L'), 'Minuta v1 enviada ao corretor%'), 'com arquivo: envia a v1 ao corretor');

-- 5) Corretor vê e baixa; quem não vê a locação não baixa ----------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('det')->'minutas') = 1 AND pg_temp.j('det')->'minutas'->0->>'enviado_por_nome' IS NOT NULL
  AND (pg_temp.j('det')->'minutas'->0->>'versao')::int = 1, 'corretor vê a versão, a data e quem anexou');
SELECT pg_temp.put('mid', to_jsonb(pg_temp.j('det')->'minutas'->0->>'id'));
SELECT pg_temp.ok(public.locacao_minuta_ver((pg_temp.j('mid') #>> '{}')::uuid)->>'path' = pg_temp.p('v1'),
  'corretor dono baixa a minuta (servidor gera a URL assinada)');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_ver(%L)', pg_temp.j('mid') #>> '{}')) LIKE '42501%',
  'outro corretor da mesma imobiliária não baixa');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_ver(%L)', pg_temp.j('mid') #>> '{}')) LIKE '42501%',
  'pessoa de outra imobiliária não baixa');

-- 6) Registro de andamento (sem mudar a situação) -------------------------------------------------------------------
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_andamento_registrar(%L, ''Aguardando algo'', ''proprietario'')',
  pg_temp.id('L'))) LIKE '42501%', 'corretor não registra andamento do setor de contratos');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_andamento_registrar(%L, ''Aguardando banco'', ''banco'')',
  pg_temp.id('L'))) LIKE '22023%', '"aguardando quem" fora da lista é recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_andamento_registrar(%L, ''oi'', NULL)', pg_temp.id('L'))) LIKE '22023%',
  'andamento sem descrição é recusado');
SELECT pg_temp.put('n1', public.locacao_andamento_registrar(pg_temp.id('L'), 'Aguardando retorno do proprietário sobre a pintura', 'proprietario'));
SELECT pg_temp.put('n2', public.locacao_andamento_registrar(pg_temp.id('L'), 'Enviar RG legível do locatário', 'corretor'));
SELECT pg_temp.put('n3', public.locacao_andamento_registrar(pg_temp.id('L'), 'Liguei para a seguradora: análise em 48 h', NULL));
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'estado' = 'com_corretor'
  AND public.locacao_detalhe(pg_temp.id('L'))->>'etapa' = 'minuta', 'andamento não muda a situação da minuta');
SELECT pg_temp.ok(pg_temp.ev(pg_temp.id('L'), 'Andamento: Aguardando retorno do proprietário sobre a pintura — aguardando proprietário'),
  'andamento vai também para o histórico');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('det')->'andamentos') = 3
  AND (SELECT count(*) FROM jsonb_array_elements(pg_temp.j('det')->'andamentos') a WHERE a->>'aguardando' IS NOT NULL
        AND a->>'resolvido_em' IS NULL) = 2, 'corretor vê a lista: 2 abertas e 1 nota livre');
SELECT pg_temp.ok(public.locacao_andamento_resolver((pg_temp.j('n2')->>'id')::uuid, 'RG enviado por e-mail'),
  'corretor resolve o que aguarda o corretor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_andamento_resolver(%L)', pg_temp.j('n1')->>'id')) LIKE '42501%',
  'corretor não resolve o que aguarda o proprietário');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_andamento_resolver(%L)', pg_temp.j('n1')->>'id')) LIKE '42501%',
  'outra imobiliária não resolve');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(public.locacao_andamento_resolver((pg_temp.j('n1')->>'id')::uuid, 'Proprietário aceitou'), 'contratos resolve qualquer uma');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_andamento_resolver(%L)', pg_temp.j('n1')->>'id')) LIKE '22023%não está aberto%'
  AND pg_temp.err(format('SELECT public.locacao_andamento_resolver(%L)', pg_temp.j('n3')->>'id')) LIKE '22023%não está aberto%',
  'resolvida ou nota livre não se resolve de novo');
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok((SELECT count(*) FROM jsonb_array_elements(pg_temp.j('det')->'andamentos') a WHERE a->>'resolvido_em' IS NOT NULL
   AND a->>'resolvido_por_nome' IS NOT NULL) = 2, 'lista mostra as resolvidas com data e quem resolveu');

-- 7) "Cobrar pendência" e "Marcar em ajuste" continuam iguais; versão nova volta para "elaborando" -----------------
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'marcar_ajuste', '{"texto":"Proprietário pediu cláusula de pintura"}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'estado' = 'ajuste', 'Marcar em ajuste: igual');
SELECT pg_temp.arquivo('v2', public.locacao_minuta_preparar(pg_temp.id('L'), 'pdf')->>'path');
SELECT pg_temp.ok((public.locacao_minuta_registrar(pg_temp.id('L'), pg_temp.p('v2'), 'minuta-ajustada.pdf', 'anexo')->>'versao')::int = 2,
  'versão ajustada vira a v2');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'estado' = 'ajuste'
  AND pg_temp.ev(pg_temp.id('L'), 'Minuta v2 anexada%'), 'v2 guardada; o "em ajuste" só sai quando reenviar');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'cobrar_pendencia', '{"texto":"Falta o e-mail do proprietário"}');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'estado' = 'pendencia', 'Cobrar pendência: igual');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_corretor_minuta(pg_temp.id('L'), 'resolver_pendencia', 'E-mail enviado');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'enviar_minuta');
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'versao_enviada')::int = 2, 'reenviada: corretor recebe a v2');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok((SELECT array_agg((m->>'versao')::int) FROM jsonb_array_elements(public.locacao_detalhe(pg_temp.id('L'))->'minutas') m)
  = ARRAY[2, 1], 'corretor vê a versão atual (v2) e o histórico (v1)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_corretor_minuta(%L, ''de_acordo'', ''1'')', pg_temp.id('L')))
  LIKE '22023%mudou (agora é a v2)%', '"de acordo" com a tela velha (v1) é recusado: a v2 foi enviada depois');
SELECT public.locacao_corretor_minuta(pg_temp.id('L'), 'de_acordo', '2');
SELECT pg_temp.ok((public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'versao_aprovada')::int = 2
  AND pg_temp.ev(pg_temp.id('L'), 'Corretor/proprietário de acordo com a minuta v2'), '"de acordo" registra a versão aprovada (v2)');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.arquivo('v3', public.locacao_minuta_preparar(pg_temp.id('L'), 'pdf')->>'path');
SELECT public.locacao_minuta_registrar(pg_temp.id('L'), pg_temp.p('v3'), 'v3.pdf', 'anexo');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('L'))->'minuta'->>'estado' = 'elaborando'
  AND pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''preparar_assinatura'')', pg_temp.id('L'))) LIKE '22023%aprovada%',
  'versão nova depois do "de acordo": volta a elaborando e precisa de novo envio');
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'enviar_minuta');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_corretor_minuta(pg_temp.id('L'), 'de_acordo');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('L'), 'preparar_assinatura');
SELECT pg_temp.put('det', public.locacao_detalhe(pg_temp.id('L')));
SELECT pg_temp.ok(pg_temp.j('det')->>'etapa' = 'assinatura' AND (pg_temp.j('det')->'minuta'->>'versao_assinatura')::int = 3,
  'aprovada → assinatura com a versão v3 registrada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_minuta_preparar(%L, ''pdf'')', pg_temp.id('L'))) LIKE '22023%etapa%',
  'fora da etapa Minuta não anexa');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_andamento_registrar(%L, ''Aguardando DocuSign do locador'', ''proprietario'')',
  pg_temp.id('L'))) IS NULL, 'andamento também na etapa Assinatura');
RESET ROLE;
UPDATE public.locacoes SET etapa = 'pos_assinatura' WHERE id = pg_temp.id('L');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.ok(public.locacao_andamento_resolver((SELECT (a->>'id')::uuid FROM jsonb_array_elements(public.locacao_detalhe(pg_temp.id('L'))->'andamentos') a
  WHERE a->>'texto' LIKE 'Aguardando DocuSign%')), 'pendência aberta ainda pode ser resolvida depois da assinatura');

-- 7a) "Gerar e guardar" na locação com fiador (tem modelo)
RESET ROLE;
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, minuta)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'minuta', 'Rua Fiador, 3 (fictícia)', 1900, 'fiador', 'residencial',
        '{"estado":"elaborando","externa":false}') RETURNING pg_temp.setid('G', id);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.arquivo('g1', public.locacao_minuta_preparar(pg_temp.id('G'), 'pdf')->>'path');
SELECT pg_temp.ok((public.locacao_minuta_registrar(pg_temp.id('G'), pg_temp.p('g1'), 'contrato-LOC-gerado.pdf', 'gerada')->>'versao')::int = 1
  AND pg_temp.ev(pg_temp.id('G'), 'Minuta v1 gerada pelo modelo e guardada%'), '"Gerar e guardar" no fiador vira a v1 (gerada pelo modelo)');

-- 7b) Locação que já estava "com o corretor" sem arquivo (caso da nº 12 em produção, que NÃO é alterada)
RESET ROLE;
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, minuta)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'minuta', 'Rua Antiga, 12 (fictícia)', 2000, 'seguro_fianca', 'residencial',
        '{"estado":"com_corretor","externa":false,"modelo":"Residencial — Seguro-fiança"}') RETURNING pg_temp.setid('V', id);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_corretor_minuta(%L, ''de_acordo'')', pg_temp.id('V')))
  LIKE '22023%Ainda não há arquivo de minuta%', 'locação antiga "com o corretor" sem arquivo: o corretor não aprova o nada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_corretor_minuta(%L, ''pedir_ajuste'', ''Proprietário quer revisar'')', pg_temp.id('V'))) IS NULL,
  'mas ainda pode pedir ajuste (volta para o setor de contratos)');

-- 8) Atalho "minuta pronta de outra RE/MAX" com o arquivo anexado -------------------------------------------------
RESET ROLE;
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, minuta)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'minuta', 'Rua Externa, 9 (fictícia)', 2800, 'seguro_fianca', 'comercial',
        '{"estado":"elaborando","externa":false}') RETURNING pg_temp.setid('E', id);
INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo)
SELECT pg_temp.id('orgA'), pg_temp.id('E'), x, 'minuta-teste/' || x, 'x.pdf'
  FROM unnest(public.locacao_checklist_l((SELECT l FROM public.locacoes l WHERE l.id = pg_temp.id('E')))) x;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('E'), 'minuta_externa', '{"externa":true}');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_contratos_acao(%L, ''preparar_assinatura'')', pg_temp.id('E')))
  LIKE '22023%Assinatura travada%', 'atalho sem arquivo: travado');
SELECT pg_temp.arquivo('e1', public.locacao_minuta_preparar(pg_temp.id('E'), 'pdf')->>'path');
SELECT public.locacao_minuta_registrar(pg_temp.id('E'), pg_temp.p('e1'), 'minuta-outra-remax.pdf', 'anexo');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('E'))->'minutas'->0->>'origem' = 'externa'
  AND pg_temp.ev(pg_temp.id('E'), 'Minuta v1 de outra RE/MAX anexada%'), 'anexo com o atalho ligado fica marcado como de outra RE/MAX');
SELECT public.locacao_contratos_acao(pg_temp.id('E'), 'preparar_assinatura');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('E'))->>'etapa' = 'assinatura', 'atalho com arquivo: pula a aprovação e segue à assinatura');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
